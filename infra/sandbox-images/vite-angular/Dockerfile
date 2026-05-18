FROM node:22-bookworm-slim

WORKDIR /workspace
RUN cd /tmp \
  && npx -y @angular/cli@latest new starter --directory starter --skip-git --package-manager npm --defaults --skip-install \
  && cp -a /tmp/starter/. /workspace/ \
  && cd /workspace \
  && npm install \
  && rm -rf /tmp/starter

EXPOSE 4173
CMD ["sleep", "infinity"]
