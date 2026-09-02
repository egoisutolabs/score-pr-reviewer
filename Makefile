.PHONY: dev check evals install
install:
	npm install --prefix web && cd agent && uv sync
dev:
	npm run dev
check:
	npm run check
evals:
	npm run evals
