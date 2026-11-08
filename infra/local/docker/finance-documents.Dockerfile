# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
ADD --checksum=sha256:7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z /usr/local/bin/minio
RUN chmod 0555 /usr/local/bin/minio \
    && minio --version | grep -F "RELEASE.2025-09-07T16-13-09Z" \
    && mkdir /data && chown node:node /data
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=30 CMD ["node", "-e", "fetch('http://127.0.0.1:4568/minio/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--address", ":4568", "--console-address", ":4569"]
