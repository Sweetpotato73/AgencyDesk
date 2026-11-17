// Starts Postgres + MinIO. Uses `docker compose` when available, otherwise plain `docker run`.
import { execSync, spawnSync } from 'node:child_process';

const action = process.argv[2] ?? 'up';
const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

if (hasCompose) {
  execSync(action === 'up' ? 'docker compose up -d' : 'docker compose down', { stdio: 'inherit' });
  process.exit(0);
}

const containers = [
  {
    name: 'portal-postgres',
    args: '-e POSTGRES_USER=portal -e POSTGRES_PASSWORD=portal -e POSTGRES_DB=portal -p 5433:5432 -v portal_pgdata:/var/lib/postgresql/data postgres:16-alpine',
  },
  {
    name: 'portal-minio',
    args: '-e MINIO_ROOT_USER=portal-minio -e MINIO_ROOT_PASSWORD=portal-minio-secret -e MINIO_API_CORS_ALLOW_ORIGIN=* -p 9010:9000 -p 9011:9001 -v portal_miniodata:/data minio/minio:latest server /data --console-address :9001',
  },
];

const exists = (n) => spawnSync('docker', ['inspect', n], { stdio: 'ignore' }).status === 0;

for (const c of containers) {
  if (action === 'up') {
    if (exists(c.name)) execSync(`docker start ${c.name}`, { stdio: 'inherit' });
    else execSync(`docker run -d --restart unless-stopped --name ${c.name} ${c.args}`, { stdio: 'inherit' });
  } else if (exists(c.name)) {
    execSync(`docker stop ${c.name}`, { stdio: 'inherit' });
  }
}
