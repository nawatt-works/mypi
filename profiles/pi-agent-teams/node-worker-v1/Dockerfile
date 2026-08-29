FROM node@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f
LABEL org.opencontainers.image.title="My Pi delegated Node worker"
LABEL org.opencontainers.image.description="Phase 0 immutable toolchain fixture for worktree-only Pi workers"
LABEL org.opencontainers.image.version="24.15.0-phase0.1"
LABEL org.opencontainers.image.base.name="docker.io/library/node:24.15.0-alpine3.23"
LABEL org.opencontainers.image.base.digest="sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f"
LABEL io.mypi.profile="pi-agent-teams-docker-strong-v1"
WORKDIR /workspace
USER node
CMD ["node", "--version"]
