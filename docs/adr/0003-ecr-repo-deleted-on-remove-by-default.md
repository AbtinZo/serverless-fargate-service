# ECR repo deleted on `serverless remove` by default

In build mode the plugin creates the ECR repository **out-of-band** (via the AWS
CLI in the build hook, not as a CloudFormation resource) because the image must
exist before the stack's task definition can reference it. On `serverless remove`
the plugin **force-deletes that repo and its images by default**; opt out with
`image.retainRepositoryOnRemove: true`.

We chose delete-by-default for least surprise: `remove` should mean remove, and
leaving orphan repos (with storage cost) behind across ephemeral/PR stacks is a
worse default than losing rollback images — which the opt-in restores for the
long-lived-service case that wants image history.

## Considered Options

- **Retain by default** _(initial scaffold behavior, rejected)_ — preserves rollback
  images, but `remove` silently leaves repos behind, surprising users and
  accumulating orphans across stacks.
- **Delete by default, opt-in retain** _(chosen)_ — clean teardown by default;
  `retainRepositoryOnRemove: true` keeps the repo for rollback when wanted.
- **Repo as a stack resource with `DeletionPolicy: Retain`** — rejected: conflicts
  with out-of-band creation (CFN can't adopt the pre-created repo without import),
  and CFN can't delete a non-empty repo without force anyway.

## Consequences

- The plugin owns an `after:remove:remove` hook that deletes only repos it created
  (build mode); a consume-mode `image.uri` repo is never touched.
- Deleting a repo on `remove` destroys its rollback images — intended; users who
  need them set `retainRepositoryOnRemove: true`.
- Out-of-band creation (the ordering driver) is unchanged by this decision.
