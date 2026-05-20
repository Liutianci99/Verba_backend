#!/bin/bash
# 提交/推送前自动运行 Maven 编译检查
# 仅在 git commit / git push 时触发，其他命令直接放行

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# 检查是否是 commit 或 push 命令
if echo "$COMMAND" | grep -qE 'git commit|git push'; then
  echo ">>> 提交前检查：运行 mvn clean install..." >&2

  cd "$(echo "$INPUT" | jq -r '.cwd')"

  # 跳过纯文档提交的编译（可选：按需启用）
  # STAGED=$(git diff --cached --name-only 2>/dev/null)
  # if echo "$STAGED" | grep -qvE '\.(md|yml|yaml|json|txt|sh|sql|xml|properties)$'; then
  #   echo ">>> 仅文档/配置变更，跳过 Maven 编译检查" >&2
  #   exit 0
  # fi

  # 运行 Maven 编译（含 enforcer 守护规则校验）
  mvn clean install -DskipTests -B -ntp 2>&1 | tail -50
  BUILD_EXIT=${PIPESTATUS[0]}
  if [ $BUILD_EXIT -ne 0 ]; then
    echo ">>> Maven 编译失败，提交已阻止。请先修复编译错误。" >&2
    exit 2
  fi

  echo ">>> Maven 编译通过，继续执行提交。" >&2
fi

exit 0
