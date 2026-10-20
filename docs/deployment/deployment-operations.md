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

## Create the Showcase and Sandbox

**Open the demo** on the login screen signs visitors in to the Showcase Workspace. The API never creates it on start. Until the Operator runs the command below, **Open the demo** fails and `POST /api/auth/sign-in/showcase` answers 404.

1. Open a terminal in the running API container, as in [Create the Operator](#create-the-operator).
2. Run the command:

   ```sh
   node dist/create-demo-workspaces.js
   ```

3. Confirm that the output reports the Showcase Workspace, the Sandbox Workspace, the Viewer of the Showcase and the Admin of the Sandbox.
4. If the output shows a password, store it in the secret manager now. The command shows it only once.

The command creates two seeded Workspaces with fictional companies and their traffic:

- The **Showcase Workspace** that visitors browse read-only. Its only Member is a fixed Viewer without a password. **Open the demo** signs the visitor in as this Viewer, and as nobody else.
- The **Sandbox Workspace** where visitors may change anything. Its Admin is `showcase-admin@edi-bridge.example`, who is not an Operator.

The command uses `DATABASE_URL` and `CHANNEL_SECRET_KEY` from the application's **Environment** settings. It also reads one optional variable:

| Variable                  | Default                     | Description                                                                          |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `SHOWCASE_ADMIN_PASSWORD` | A generated random password | The password of the Sandbox Admin, at least 8 characters. Read only by this command. |

To choose the password, set `SHOWCASE_ADMIN_PASSWORD` for this one command only. Do not add it to the application's **Environment** settings. Without it, the command generates a strong password and prints it once to its own output. The API never logs it.

```sh
SHOWCASE_ADMIN_PASSWORD='<password>' node dist/create-demo-workspaces.js
```

Running the command again is safe. It does not seed an existing Workspace again, and it never changes an existing role or password. It adds what is missing: a Workspace, a user, or the membership of the Viewer in the Showcase or of the Admin in the Sandbox. If the Viewer or the Sandbox Admin is an Operator or has any other membership, the command grants nothing and fails with a message that names the user. Remove those rights and run the command again.

The seeded Channels of both Workspaces point at reserved hosts and never send. **Test connection** on one of them answers that it never sends.

The Showcase sign-in refuses to sign anyone in once the Viewer gains any right beyond a Viewer of the Showcase, such as another Workspace, a higher role or the Operator role. Do not invite or promote the Viewer.

## Reset the Sandbox

A reset replaces all data of the Sandbox Workspace with its seed: Trading Partners, Lookup Tables, Document Structures, Mappings, Channels, Flows, Documents, Runs and the AI usage of the day. It keeps the Workspace, its name, its Operator settings, its Members, open invites and sessions. It never changes another Workspace. A reset cannot be undone.

To reset the Sandbox in the Operator area:

1. Sign in as the Operator and open the Operator area.
2. Open the Sandbox Workspace and select **Danger zone**.
3. Select **Reset Sandbox**, then confirm with **Reset Sandbox**.
4. Confirm that **Last reset** shows the current time.

To reset the Sandbox from a terminal:

1. Open a terminal in the running API container, as in [Create the Operator](#create-the-operator).
2. Run the command:

   ```sh
   node dist/reset-sandbox.js
   ```

3. Confirm that the output reports the Sandbox Workspace as reset to its seed.

The command uses `DATABASE_URL` and `CHANNEL_SECRET_KEY` from the application's **Environment** settings. If no Sandbox exists, it fails with a message. Run [Create the Showcase and Sandbox](#create-the-showcase-and-sandbox) first.

A Run that the worker still has queued for the Sandbox at the time of the reset is dropped without an error. Screens of the Sandbox that are open in another browser show the new data after a reload.

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
2. Update the corresponding connection URL in each affected application's **Environment** settings. Postgres uses `DATABASE_URL` in both API and worker. Redis uses `REDIS_URL` in both API and worker.
3. Redeploy each affected application.
4. Follow [Verify the deployment](#verify-the-deployment).

## Handle build memory failures

If a build fails with an out-of-memory error or exit code 137, record the affected deployment. Switch to images built in CI before retrying the deployment.

## Add an application to the tunnel

Read the private installation notes to identify the existing tunnel. Reuse that tunnel for applications on the same VPS. If an application requires separate credentials, network access, or a separate lifecycle, use a separate tunnel. See [Routing](deployment.md#routing) for the existing tunnel and Traefik configuration.
