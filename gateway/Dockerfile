FROM node:24-bookworm-slim
RUN corepack enable
WORKDIR /opt/sovereign-mail
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY gateway/package.json ./gateway/package.json
RUN pnpm install --filter @sovereign-mail/native-gateway --prod --frozen-lockfile
COPY --chown=node:node gateway/src ./gateway/src
USER node
ENV SOVEREIGN_MAIL_BIND_ADDRESS=0.0.0.0 \
    SOVEREIGN_MAIL_IMAP_PORT=1993 \
    SOVEREIGN_MAIL_SMTP_PORT=1465 \
    PORT=8080
EXPOSE 1993 1465 8080
CMD ["node", "gateway/src/main.mjs"]
