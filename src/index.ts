/**
 * serverless-fargate-service
 *
 * Deploy long-running container web services to AWS ECS Fargate behind a
 * fully-tunable Application Load Balancer — defined entirely in serverless.yml.
 *
 * Lifecycle:
 *   before:package:finalize  -> resolve image URIs, synthesize CFN, merge into stack
 *   before:deploy:deploy     -> build & push images (build mode only)
 *   after:deploy:deploy      -> print service outputs
 *   after:remove:remove      -> delete the ECR repo (build mode; opt-out via retain)
 */
import { FARGATE_SCHEMA } from './schema';
import { synthesize } from './synthesize';
import { FargateConfig, ServiceConfig } from './types';
import { physicalName } from './naming';
import {
  BuildPlan,
  buildAndPush,
  deleteRepository,
  ecrUri,
  resolveRepoSettings,
  resolveTag,
} from './image';
import { resolveHostedZoneId } from './route53';

// Minimal structural typings for the Serverless instance we touch.
interface Serverless {
  service: any;
  configurationInput?: any;
  serviceDir?: string;
  config?: { servicePath?: string };
  getProvider(name: string): {
    getRegion(): string;
    getStage(): string;
    getAccountId(): Promise<string>;
  };
  configSchemaHandler: {
    defineTopLevelProperty(name: string, schema: unknown): void;
  };
  cli: { log(msg: string): void };
}

class ServerlessFargateService {
  serverless: Serverless;
  provider: ReturnType<Serverless['getProvider']>;
  hooks: Record<string, () => void | Promise<void>>;
  private buildPlans: BuildPlan[] = [];

  constructor(serverless: Serverless) {
    this.serverless = serverless;
    this.provider = serverless.getProvider('aws');
    serverless.configSchemaHandler.defineTopLevelProperty('fargate', FARGATE_SCHEMA);

    this.hooks = {
      'before:package:finalize': () => this.compile(),
      'before:deploy:deploy': () => this.buildImages(),
      'after:deploy:deploy': () => this.printOutputs(),
      'after:remove:remove': () => this.removeRepositories(),
    };
  }

  /** ECR repo name for a build-mode service. Shared by deploy and remove. */
  private repoName(serviceName: string, stage: string, key: string): string {
    return physicalName(`${serviceName}-${stage}`, key).toLowerCase();
  }

  private log(msg: string): void {
    this.serverless.cli.log(`[fargate] ${msg}`);
  }

  private getConfig(): FargateConfig | undefined {
    return this.serverless.configurationInput?.fargate ?? this.serverless.service?.fargate;
  }

  private serviceDir(): string {
    return this.serverless.serviceDir ?? this.serverless.config?.servicePath ?? process.cwd();
  }

  /** Resolve build-mode image URIs and record a build plan for each. */
  private async resolveImages(config: FargateConfig, region: string): Promise<void> {
    const cwd = this.serviceDir();
    const serviceName: string = this.serverless.service.service;
    const stage = this.provider.getStage();
    let account: string | undefined;

    for (const [key, svc] of Object.entries<ServiceConfig>(config.services)) {
      if (svc.image.uri) continue; // consume mode — nothing to build
      if (!svc.image.context) {
        throw new Error(`fargate.services.${key}.image needs either 'uri' or 'context'`);
      }
      account ??= await this.provider.getAccountId();
      const region2 = region;
      const repo = this.repoName(serviceName, stage, key);
      const tag = resolveTag(svc.image.tag, cwd);
      const imageUri = ecrUri(account, region2, repo, tag);
      svc.image.uri = imageUri; // synth embeds the real URI
      this.buildPlans.push({
        serviceKey: key,
        repository: repo,
        tag,
        imageUri,
        context: svc.image.context,
        dockerfile: svc.image.dockerfile ?? 'Dockerfile',
        platform: svc.image.platform ?? 'linux/amd64',
        region: region2,
        registry: `${account}.dkr.ecr.${region2}.amazonaws.com`,
        repo: resolveRepoSettings(svc.image),
      });
    }
  }

  /** Fill in any omitted domain.hostedZoneId by resolving it from the domain. */
  private resolveDomains(config: FargateConfig): void {
    for (const [key, svc] of Object.entries<ServiceConfig>(config.services)) {
      if (!svc.domain || svc.domain.hostedZoneId) continue;
      svc.domain.hostedZoneId = resolveHostedZoneId(svc.domain.name);
      this.log(`resolved hosted zone for ${key} (${svc.domain.name}): ${svc.domain.hostedZoneId}`);
    }
  }

  async compile(): Promise<void> {
    const config = this.getConfig();
    if (!config) return;

    const region = this.provider.getRegion();
    const stage = this.provider.getStage();
    const serviceName: string = this.serverless.service.service;

    await this.resolveImages(config, region);
    this.resolveDomains(config);

    const fragment = synthesize(config, { service: serviceName, stage });
    const tpl = this.serverless.service.provider.compiledCloudFormationTemplate;
    tpl.Resources = { ...(tpl.Resources ?? {}), ...fragment.Resources };
    tpl.Outputs = { ...(tpl.Outputs ?? {}), ...fragment.Outputs };

    this.log(`synthesized ${Object.keys(config.services).length} service(s) into the stack`);
  }

  buildImages(): void {
    for (const plan of this.buildPlans) {
      buildAndPush(plan, (m) => this.log(m));
    }
  }

  printOutputs(): void {
    const config = this.getConfig();
    if (!config) return;
    for (const [key, svc] of Object.entries<ServiceConfig>(config.services)) {
      if (svc.domain) this.log(`${key}: https://${svc.domain.name}`);
    }
  }

  /**
   * On `serverless remove`, delete the ECR repos the plugin created (build
   * mode). Default behavior — set image.retainRepositoryOnRemove to keep a
   * repo (and its images) for rollback. Never touches a consume-mode repo,
   * which the plugin did not create.
   */
  removeRepositories(): void {
    const config = this.getConfig();
    if (!config) return;
    const region = this.provider.getRegion();
    const stage = this.provider.getStage();
    const serviceName: string = this.serverless.service.service;

    for (const [key, svc] of Object.entries<ServiceConfig>(config.services)) {
      if (svc.image.uri || !svc.image.context) continue; // consume mode — not ours to delete
      if (svc.image.retainRepositoryOnRemove) {
        this.log(`retaining ECR repo for ${key} (retainRepositoryOnRemove)`);
        continue;
      }
      deleteRepository(this.repoName(serviceName, stage, key), region, (m) => this.log(m));
    }
  }
}

export = ServerlessFargateService;
