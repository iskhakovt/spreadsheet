// Single source of truth for the prod image build.
//
// Local: `docker buildx bake --set app.args.VERSION=$(git describe --tags --always)`
// CI: see .github/workflows/publish.yml — metadata-action emits a bake file
//     with tags/labels/annotations that gets layered on top of this one.

variable "VERSION" {
  default = "dev"
}

target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]

  args = {
    VERSION = "${VERSION}"
  }

  // Per-platform cache scopes — single buildx invocation can emit/read both
  // without the "last platform wins" overwrite bug (moby/buildkit#2758).
  cache-from = [
    "type=gha,scope=amd64",
    "type=gha,scope=arm64",
  ]
  cache-to = [
    "type=gha,scope=amd64,mode=max",
    "type=gha,scope=arm64,mode=max",
  ]

  attest = [
    "type=provenance,mode=max",
    "type=sbom",
  ]
}
