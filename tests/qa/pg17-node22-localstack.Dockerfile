# KatoSync Stage4E no-deploy Auth→Edge→PG17 integration, disposable CI only.
# Official PostgreSQL image; Alpine 3.22 nodejs main package is Node 22 LTS.
FROM postgres:17-alpine3.22
RUN apk add --no-cache bash nodejs
USER postgres
WORKDIR /src
# The workflow overrides entrypoint with a single hermetic QA command.
