.PHONY: test start stop restart

test:
	@echo "Running smoke tests..."
	@python3 tests/smoke_test.py

start:
	@echo "Starting server..."
	@cd backend && . venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 &

stop:
	@echo "Stopping server..."
	@fuser -k 8000/tcp 2>/dev/null || true

restart: stop start
	@echo "Waiting for server to start..."
	@sleep 3
	@make test
