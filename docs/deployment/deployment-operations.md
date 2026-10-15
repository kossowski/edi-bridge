# Deploy and maintain EDI Bridge

Use this guide to deploy EDI Bridge and check the applications on Dokploy. Before changing an existing installation, read its notes in `.local/deployment/`. See [Dokploy deployment configuration](deployment.md) for the deployment layout and [Private deployment notes](private-notes.md) for access and storage options.

## Set environment variables

Set the runtime variables in Dokploy:

1. Open each application's **Environment** settings in Dokploy.
2. Set the values listed in [Environment variables](deployment.md#environment-variables).
3. Replace each password placeholder with the corresponding password stored in Dokploy. If a password contains characters with a special meaning in URLs, URL-encode the password.

Keep production passwords in Dokploy. Do not commit passwords. Do not put these runtime variables in Docker build arguments.

## Create the Operator

A fresh installation has no users. Create the Operator once, after the first deployment of the API:

1. Open a terminal in the running API container, either through the Dokploy terminal of the API application or with `docker exec`:

   ```sh
   docker exec -it <api-container> sh
   ```

2. Run the command and enter the password at the prompt:

   ```sh
   node dist/create-operator.js --email <operator-email> --name "<operator-name>" --workspace "<workspace-name>"
   ```

   To pass the password without a prompt, set `OPERATOR_PASSWORD` for this one command only. Do not add it to the application's **Environment** settings.

   ```sh
   OPERATOR_PASSWORD='<password>' node dist/create-operator.js --email <operator-email> --name "<operator-name>" --workspace "<workspace-name>"
   ```

3. Confirm that the output reports the user, the Workspace, the Operator role and the Admin role.

The command creates the Workspace if no Workspace has that name, and makes the user Operator and Admin of it. `--workspace` matches the exact Workspace name. A misspelt name creates a new Workspace, so copy the name of an existing Workspace exactly. The password needs at least 8 characters. The command never prints the password.

Running the command again is safe. An existing user keeps their password and roles; the command grants only a missing Operator or Admin role. To replace the password of an existing user, add `--reset-password`.

## Deploy a change

Deploy changes through the GitHub integration:

1. Merge the reviewed change into `main` after the required CI checks pass.
2. For each application whose **Watch Paths** match the change, open its deployment history in Dokploy.
3. Confirm that the deployment uses the merged commit.
4. Confirm that the build completed successfully.
5. Follow [Verify the deployment](#verify-the-deployment).

If an application gains a dependency on another workspace package, add that package's path to the application's **Watch Paths** before deployment. See [Deployment triggers](deployment.md#deployment-triggers) for the existing patterns.

## Verify the deployment

A successful build does not prove that the application can reach its dependencies. Set `EDI_BRIDGE_URL` to the installation origin from the private notes:

```sh
	export EDI_BRIDGE_URL=https://edi-bridge.example.com
```

Check the public endpoints and the worker:

1. Check the web endpoint:

   ```sh
   curl -fsS "${EDI_BRIDGE_URL}/" > /dev/null
   ```

   Confirm that `curl` exits successfully.

2. Check the API health endpoint:

   ```sh
   curl -fsS "${EDI_BRIDGE_URL}/api/health"
   ```

   Confirm that the response matches the [healthy API response](deployment.md#health-checks).

3. Inspect the worker's runtime logs and container health in Dokploy. Confirm that the worker can reach Redis and that its container is healthy.

## Redeploy an application

To deploy without a Git change, use Dokploy:

1. Open the application in Dokploy.
2. Select **Deploy**.
3. Follow [Verify the deployment](#verify-the-deployment).

An application redeployment preserves the Postgres and Redis volumes.

## Rotate database passwords

Update the database password and the affected applications together:

1. Change the password for the affected database service in Dokploy.
2. Update the corresponding connection URL in each affected application's **Environment** settings. Postgres uses `DATABASE_URL` in API. Redis uses `REDIS_URL` in both API and worker.
3. Redeploy each affected application.
4. Follow [Verify the deployment](#verify-the-deployment).

## Handle build memory failures

If a build fails with an out-of-memory error or exit code 137, record the affected deployment. Switch to images built in CI before retrying the deployment.

## Add an application to the tunnel

Read the private installation notes to identify the existing tunnel. Reuse that tunnel for applications on the same VPS. If an application requires separate credentials, network access, or a separate lifecycle, use a separate tunnel. See [Routing](deployment.md#routing) for the existing tunnel and Traefik configuration.
