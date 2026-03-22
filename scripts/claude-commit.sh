#!/bin/bash
# Claude Commit Helper - Use Claude to generate commit messages
# Usage: ./scripts/claude-commit.sh "your prompt"

# Check for Anthropic API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    if [ -f "$HOME/.claude/api-key.txt" ]; then
        export ANTHROPIC_API_KEY=$(cat "$HOME/.claude/api-key.txt")
    else
        echo "Error: ANTHROPIC_API_KEY not set"
        echo "Set it with: export ANTHROPIC_API_KEY=your_api_key"
        exit 1
    fi
fi

PROMPT="${1:-Generate a good commit message for the current changes}"
MODEL="${CLAUDE_MODEL:-claude-sonnet-4-20250514}"

echo "Asking Claude for commit message..."

response=$(curl -s -X POST "https://api.anthropic.com/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 1024,
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": \"Analyze the git diff and generate a concise, conventional commit message (50 chars max for title, 72 chars max per line). Also suggest a longer body if needed. Focus on 'type: subject' format. Here is the diff:\\n\\n$(git diff --no-color)\"
      }
    ]
  }")

message=$(echo "$response" | jq -r '.content[0].text // .error.message' 2>/dev/null)

if [ -z "$message" ] || [ "$message" = "null" ]; then
    echo "Error: Failed to get response from Claude"
    echo "$response"
    exit 1
fi

# Extract just the first line as commit message
commit_msg=$(echo "$message" | head -1)

echo "Claude suggests:"
echo "$message"
echo ""
read -p "Use this message? (y/n/q): " confirm

case $confirm in
    y|Y)
        git config --local user.email "claude@anthropic.com"
        git config --local user.name "Claude"

        git add -A
        git commit -m "$commit_msg" -m "Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>"
        echo "Committed!"
        ;;
    n|N)
        echo "Enter custom commit message:"
        read custom_msg
        git add -A
        git commit -m "$custom_msg"
        ;;
    *)
        echo "Aborted"
        ;;
esac
