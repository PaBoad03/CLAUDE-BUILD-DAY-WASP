# docker/ — ORANGE sandbox (owner: Felipe)

Real Docker-based Linux lab used by the ORANGE operator agent.

## Topology

```
 wasp-lab  (docker network, --internal → NO internet egress)
 ├── wasp-sandbox   alpine + iputils/bind-tools/iproute2/curl/nc   (the lab box)
 └── wasp-target    nginx:alpine                                   (safe local HTTP/port target)
```

* `wasp-sandbox` runs as an unprivileged user, `--cap-drop ALL --cap-add NET_RAW`,
  `--security-opt no-new-privileges`, memory and pid limits.
* The lab network is `--internal`, so DNS/ping/HTTP tests only reach `wasp-target`
  and loopback. Attaching the sandbox to a network with egress is a separate
  HIGH-risk tool that always requires human authorization.

## Pre-demo (do this once, on wifi, before the audience arrives)

```bash
cd apps/operator
npm install
npm run sandbox:build      # builds wasp/sandbox:latest and pulls nginx:alpine
```

Nothing is pulled during the live demo.

## Manual sanity check

```bash
docker run --rm --network none wasp/sandbox:latest ping -c 2 127.0.0.1
```
