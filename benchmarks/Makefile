PYTHON_DIRS := snapshot-agentic-use/src page-token-benchmark/src

.PHONY: format format-check lint typecheck check

format:
	black $(PYTHON_DIRS) && isort $(PYTHON_DIRS)

format-check:
	black --check $(PYTHON_DIRS) && isort --check-only $(PYTHON_DIRS)

lint:
	ruff check $(PYTHON_DIRS) && flake8 $(PYTHON_DIRS)

typecheck:
	mypy snapshot-agentic-use/src
	mypy page-token-benchmark/src

check: format-check lint typecheck
