# Advanced Computation and Teaching Release

## Service Deployment

The meeting backend does not run symbolic jobs. `compute/` is a separate optional FastAPI service backed by SymPy 1.14.0. It is disabled until `COMPUTE_SERVICE_URL` and `COMPUTE_SERVICE_KEY` are configured. No deployment, production database migration or production upload has been performed by this change.

Set a strong random `COMPUTE_SERVICE_KEY` in the deployment environment, then use:

```sh
docker compose -f docker-compose.yml -f docker-compose.compute.yml up -d --build
```

The override places the compute container on a private internal network with no published port, a non-root user, read-only filesystem, dropped capabilities, one CPU, 768 MB memory and 64-process limit. Use one Uvicorn worker: its single-job admission gate is deliberately process-local. Each request starts a disposable child process; the parent kills jobs after ten seconds, and Linux children also have eight-second CPU and 512 MB address-space limits. This is bounded process/container isolation, not permission to execute arbitrary research code.

The backend authenticates presenter/co-host credentials, bills the presentation owner, and atomically enforces a persistent UTC-day quota (default 30 requests). Accepted attempts count even if the computation times out, preventing repeated expensive retries. Busy workers return 429 with a retry hint. Multiple meeting backend replicas share quota state in the database. Quota rows cascade with user deletion. Migration `20261004_0010` creates the ledger; the existing startup schema creation also creates missing tables.

Supported operations: differentiation, antiderivatives, definite integration, one/two-sided finite or infinite limits, Taylor expansions, real equation solving, matrix eigenvalues and RREF (up to 6 by 6). The restricted expression grammar uses explicit operators, x, numerical constants, pi/e/i/oo and a small mathematical function allowlist. It constructs SymPy nodes from a bounded Python AST; it does not call eval, parse_expr or sympify on user text. General scripts, uploads, arbitrary Python, PDE solvers, proof assistants and specialist research engines are not supported.

## Explanation Claims

- Polynomial derivative steps are rebuilt and compared symbolically with the engine result.
- Antiderivatives are checked by differentiating the candidate and simplifying the difference.
- Definite-integral labels verify the antiderivative only, not every domain/singularity condition.
- Limit output records both sides. Unresolved limits remain unresolved rather than becoming a false nonexistence claim.
- Series, solutions and matrix results remain engine results, not independent proofs.
- The school lesson library contains eight starter templates with indicative teaching levels, not a complete or officially aligned curriculum.

## Release Checks

Unit/regression suites cover mathematical reference cases, unsafe expressions, service authentication/timeouts, quota boundaries, board revisions, access codes, viewer/presenter permissions and mocked S3 uploads/failures. The two-browser integration suite creates a temporary database and local server, then checks teacher-to-mobile Socket.IO updates, reconnect restoration and real shared Three.js surfaces. Production S3 access/CORS, PostgreSQL contention under load, Docker resource limits, Safari/stylus behaviour and actual LiveKit AV/recording still require staging verification. No claims of full research-mathematics coverage or formal proof verification are made.
