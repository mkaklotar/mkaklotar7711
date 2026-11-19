# syntax=docker/dockerfile:1.7
#
# OpenJarvis, pinned to the exact upstream commit that was security-reviewed,
# installed into an unprivileged runtime image. See README.md.

# Full (non-slim) image: it already ships git, so the build needs no apt-get
# and works behind proxies that only pass HTTPS. Same tag in both stages so
# the venv's interpreter path matches.
ARG PYTHON_IMAGE=python:3.12

# ---------------------------------------------------------------- build stage
FROM ${PYTHON_IMAGE} AS build

# The commit reviewed on 2026-11-19. Change only after re-reviewing.
ARG OJ_COMMIT=427c2dd11d180ac254a03e92c5fb01189fb4b23b

# Optional build secret "extra_ca": a CA bundle for networks that intercept
# TLS (corporate proxies). Never copied into the image. Ignored if absent.
RUN --mount=type=secret,id=extra_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/extra_ca ]; then \
      export GIT_SSL_CAINFO=/run/secrets/extra_ca PIP_CERT=/run/secrets/extra_ca; \
    fi; \
    git init -q /src; \
    cd /src; \
    git remote add origin https://github.com/open-jarvis/OpenJarvis.git; \
    git fetch -q --depth 1 origin "${OJ_COMMIT}"; \
    git checkout -q FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${OJ_COMMIT}"; \
    python -m venv /opt/oj; \
    # No upstream tag sits on this commit; label it as post-1.0.4 dev code.
    SETUPTOOLS_SCM_PRETEND_VERSION="1.0.5.dev0+g${OJ_COMMIT%"${OJ_COMMIT#???????}"}" \
      /opt/oj/bin/pip install --no-cache-dir /src; \
    /opt/oj/bin/jarvis --help >/dev/null

# -------------------------------------------------------------- runtime stage
FROM ${PYTHON_IMAGE}

# git (from the base image) is used only by `jarvis skill install`.
RUN useradd --uid 10001 --create-home --home-dir /home/jarvis --shell /bin/bash jarvis \
 && mkdir -p /home/jarvis/.openjarvis /home/jarvis/workspace \
 && chown jarvis:jarvis /home/jarvis/.openjarvis /home/jarvis/workspace

COPY --from=build /opt/oj /opt/oj
# Config and policy live in the read-only image filesystem, so nothing running
# inside the container (an agent with shell access included) can loosen them.
COPY config/ /etc/openjarvis/
COPY probes/ /opt/oj-sandbox/probes/
COPY entry.sh /opt/oj-sandbox/entry.sh

ENV PATH=/opt/oj/bin:${PATH} \
    OPENJARVIS_HOME=/home/jarvis/.openjarvis \
    OPENJARVIS_CONFIG=/etc/openjarvis/locked.toml \
    HOME=/home/jarvis \
    XDG_CACHE_HOME=/tmp/cache \
    HF_HOME=/tmp/hf \
    PYTHONDONTWRITEBYTECODE=1 \
    # No PyPI update check (and never run `jarvis self-update` in here).
    OPENJARVIS_NO_UPDATE_CHECK=1

USER jarvis
# Read-only and empty: OpenJarvis auto-loads ./skills from the working
# directory as *trusted* workspace skills, so nothing may be able to create one.
WORKDIR /home/jarvis

ENTRYPOINT ["/opt/oj-sandbox/entry.sh"]
CMD ["chat"]
