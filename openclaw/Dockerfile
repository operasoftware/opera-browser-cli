FROM ghcr.io/openclaw/openclaw:latest

USER root

# Install opera-browser-cli globally so it is on PATH for OpenClaw agents.
# Browser is provided by the chromedp/headless-shell sidecar in docker-compose.yml.
# Also registers SKILL.md into ~/.agents/skills/ — a path OpenClaw scans for skills
# that is not covered by any named volume, so the file lives in the image layer.
RUN npm install -g opera-browser-cli && \
    mkdir -p /home/node/.agents/skills/opera-browser-cli && \
    cp "$(npm root -g)/opera-browser-cli/SKILL.md" /home/node/.agents/skills/opera-browser-cli/SKILL.md && \
    chown -R node:node /home/node/.agents

USER node
