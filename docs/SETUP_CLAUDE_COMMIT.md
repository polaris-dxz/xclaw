# Setup Claude as Commit Co-Author

This guide explains how to configure commits with Claude as a co-author.

## Method 1: Local Script (Recommended)

### 1. Set your Anthropic API Key

```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

Or save it to a file:
```bash
mkdir -p ~/.claude
echo "your_api_key_here" > ~/.claude/api-key.txt
```

### 2. Use the Script

```bash
# Stage your changes first
git add -A

# Run the commit helper
./scripts/claude-commit.sh "your commit message prompt"

# Or just use the staged changes
./scripts/claude-commit.sh
```

The script will:
1. Call Claude API to analyze your git diff
2. Generate a commit message
3. Ask you to confirm or edit
4. Commit with Claude as co-author

## Method 2: Git Alias

Add to your `~/.gitconfig`:

```ini
[alias]
  claude-commit = "!ANTHROPIC_API_KEY=$(cat ~/.claude/api-key.txt 2>/dev/null) bash -c 'git diff --cached | ...' "
```

## Getting an Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Go to API Keys section
4. Create a new API key
5. Add credits to your account (required for API calls)

## Pricing

- Claude Sonnet (recommended): ~$3/million input tokens
- Claude Haiku (cheaper): ~$0.25/million input tokens

A typical commit message generation uses ~2,000-5,000 tokens, costing less than $0.01 per commit.

## GitHub Action (Advanced)

The `.github/workflows/claude-commit.yml` file provides a GitHub Action that can be triggered manually.

To use it:
1. Go to repository Settings > Secrets
2. Add a secret named `ANTHROPIC_API_KEY`
3. Run the workflow from GitHub Actions tab
