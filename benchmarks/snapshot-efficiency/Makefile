SRC = src

.PHONY: format check lint typecheck

# Apply formatting (local dev)
format:
	black $(SRC)/
	isort $(SRC)/

# Check formatting without modifying (CI)
format-check:
	black --check $(SRC)/
	isort --check-only $(SRC)/

lint:
	ruff check $(SRC)/
	flake8 $(SRC)/

typecheck:
	mypy $(SRC)/

# Full validation suite — no file modifications (used in CI)
check: format-check lint typecheck
