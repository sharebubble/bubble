# Project Instructions for Copilot

## General Context

This is a sharing platform built with django python and react frontend.

## Backend Instructions

- all code is in "backend" folder.
- Use Python 3.10+ for all files.
- Virtual environment is in backend/.venv
- Use Django 4.2+ for the backend framework.
- Use Django REST Framework for building APIs.
- Use PostgreSQL as the database.
- Follow PEP 8 style guide for Python code.
- Use type hints for all functions and methods.
- Use Django's built-in authentication system for user management.

## Frontend Instructions

- all code is in "frontend" folder.
- Use TypeScript for all files.
- Prefer arrow functions for component definitions.
- Use `lucide-react` for icons.

## Git Commit Instructions

All commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is enforced by CI.

**Format:** `<type>(<scope>): <description>`

**Allowed types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `style`, `test`

**Rules:**

- The description must start with a lowercase letter.
- The description must not end with a period.
- The scope is optional but must be lowercase and use only `a-z`, `0-9`, `.`, `_`, `/`, or `-`.
- Use `!` before `:` to indicate a breaking change, e.g. `feat(api)!: remove endpoint`.
- Merge commits are exempt.

**Examples:**

```
feat(items): add image rotation endpoint
fix(federation): handle missing inbox URL gracefully
chore: update dependencies
docs(api): document S3 configuration env vars
refactor(storage)!: replace minio with rustfs
```

## Additional Instructions

- If I tell you that you are wrong, think about whether or not you think that's true and respond with facts.
- Avoid apologizing or making conciliatory statements.
- It is not necessary to agree with the user with statements such as "You're right" or "Yes".
- Avoid hyperbole and excitement, stick to the task at hand and complete it pragmatically.
- Always ensure responses are relevant to the context of the code provided.
- Avoid unnecessary detail and keep responses concise.
- Revalidate before responding. Think step by step.
- Make sure you keep up high coding quality standards, specifically you need to consider linting rules, which are defined in pyproject.toml.
- Avoid writing a summary .md file unless explicitly asked to do so.
