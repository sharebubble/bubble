#!/bin/bash
set -e

cd $(dirname "$0")

uv pip install pygraphviz djangoviz

ENABLE_DJANGOVIZ=True uv run python manage.py graph_models -g -o bubble-models.png
