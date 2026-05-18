FROM node:22-bookworm-slim

WORKDIR /workspace
RUN cd /tmp \
  && npm create vite@latest starter -- --template vanilla-ts \
  && cp -a /tmp/starter/. /workspace/ \
  && cd /workspace \
  && npm install \
  && rm -rf /tmp/starter

EXPOSE 4173
CMD ["sleep", "infinity"]
