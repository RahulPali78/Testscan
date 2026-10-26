# Continuous integration template

`workspace-checks.yml` contains the proposed GitHub Actions workflow. It validates
workspace metadata, document anchors, task dependencies and cross-document backlog
consistency using Node.js 24. It does not test unimplemented application services.

The workflow is not active. To enable it, an authorized repository maintainer
must add its contents as `.github/workflows/ci.yml`, using GitHub directly or a
credential with permission to write workflows. No token is stored in this repository.
