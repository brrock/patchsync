#!/usr/bin/env bash

set -euo pipefail

grep -Fq 'PatchSync example patch applied.' README.md
