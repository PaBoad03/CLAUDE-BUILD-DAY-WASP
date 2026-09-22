# WASP ORANGE — isolated Linux sandbox for controlled network exercises.
#
# Deliberately small and deterministic. Kali was rejected: it is heavy,
# slow to pull, and adds nothing the demo needs. Every tool below is
# driven through the allowlisted executor in packages/tools — the model
# never gets a shell in here.
FROM alpine:3.20

RUN apk add --no-cache \
      iputils \
      bind-tools \
      iproute2 \
      curl \
      netcat-openbsd \
    && adduser -D -u 1000 lab

USER lab
WORKDIR /home/lab

# Keep the container alive; every test is a `docker exec` with a fixed argv.
CMD ["sleep", "infinity"]
