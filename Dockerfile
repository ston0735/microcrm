FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json domain.mjs db.mjs assistant.mjs local-server.mjs workflow.mjs company-lookup.mjs ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=3210 DATA_DIR=/data SEED_DEMO=0
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3210
CMD ["node", "local-server.mjs"]

