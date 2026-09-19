FROM node:22-alpine
ARG BW_CLI_VERSION=latest
RUN npm install -g @bitwarden/cli@${BW_CLI_VERSION} && apk add --no-cache curl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && adduser -D bw
USER bw
HEALTHCHECK --interval=60s --timeout=10s CMD curl -fs -X POST http://127.0.0.1:8087/sync || exit 1
ENTRYPOINT ["/entrypoint.sh"]
