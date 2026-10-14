# GitHub 协作指南

面向全组的操作手册。前半部分是**每个组员都要做的**，后半部分是**维护者（A 组）才用到的**。

仓库地址：`git@github.com:ahawzlc/se2026-research-platform.git`（私有库）

---

## 一、加入仓库（组员）

1. 把你的 GitHub 用户名发给 A 组，由 A 组在 Settings → Collaborators 邀请；
2. 查收 GitHub 邮件或到 https://github.com/notifications 点接受邀请；
3. 接受后即可推送分支、发起 PR。

## 二、首次配置

### 1. 安装 GitHub CLI

```bash
# Windows
winget install --id GitHub.cli -e

# macOS
brew install gh
```

### 2. 登录

```bash
gh auth login
```

按提示选 `GitHub.com` → `SSH` → 浏览器授权。或者用设备码方式（适合服务器/无浏览器环境）：

```bash
gh auth login --hostname github.com --git-protocol ssh --web
# 屏幕会给出一次性码，到 https://github.com/login/device 输入即可
```

验证：

```bash
gh auth status
```

### 3. 配置 git 身份

**必须配置**，否则提交看不到你是谁：

```bash
git config --global user.name  "你的名字"
git config --global user.email "你的邮箱"
```

> 邮箱必须是你 GitHub 账号里已添加并验证的邮箱，否则提交不会关联到你的头像与贡献图。
> 本项目 A 组使用的邮箱是 `wangzl24@mails.tsinghua.edu.cn`。

### 4. 网络不通时（本机组情况）

部分网络下 `github.com:22` 会被拒。已在 `~/.ssh/config` 配置走 443 通道：

```
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

自检命令：`ssh -T git@github.com`，返回 `Hi <你的用户名>!` 即正常。

## 三、日常开发流程

```bash
# 1. 从 develop 拉最新代码
git switch develop
git pull --rebase origin develop

# 2. 切功能分支（命名见 CONTRIBUTING.md）
git switch -c feature/task-kanban

# 3. 开发、提交
git add .
git commit -m "feat(task): 支持看板拖拽换列"

# 4. 推送分支
git push -u origin feature/task-kanban

# 5. 发起 PR（目标分支选 develop）
gh pr create --base develop --fill
#    或者交互式填写：
gh pr create --base develop

# 6. 找至少 1 人评审，通过后合并
gh pr merge --squash --delete-branch
```

**不要直接往 `main` 推**——该分支已设保护，只接受 PR。

## 四、常用命令速查

| 想做的事 | 命令 |
| --- | --- |
| 在浏览器打开仓库 | `gh repo view --web` |
| 在浏览器打开当前 PR | `gh pr view --web` |
| 列出待评审的 PR | `gh pr list` |
| 查看某个 PR | `gh pr view 12` |
| 把别人的 PR 拉下来本地跑 | `gh pr checkout 12` |
| 审查 PR | `gh pr review 12 --approve` ／ `--comment` ／ `--request-changes` |
| 合并 PR | `gh pr merge --squash --delete-branch` |
| 建 issue | `gh issue create --title "..." --body "..."` |
| 列 issue | `gh issue list` |
| 看 CI 运行状态 | `gh run list` ／ `gh run watch` |
| 看仓库概况（star/fork/PR） | `gh repo view` |
| 查看登录状态 | `gh auth status` |
| 登出 | `gh auth logout` |

常用别名（可选，配上更省事）：

```bash
gh alias set prc 'pr create --base develop --fill'
gh alias set prm 'pr merge --squash --delete-branch'
```

## 五、维护者操作（A 组）

### 1. 设置 main 分支保护

```bash
gh api -X PUT repos/ahawzlc/se2026-research-platform/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
JSON
```

查看当前保护规则：

```bash
gh api repos/ahawzlc/se2026-research-platform/branches/main/protection
```

### 2. 邀请协作者

```bash
gh api -X PUT repos/ahawzlc/se2026-research-platform/collaborators/<对方用户名> \
  -f permission=push
```

`permission` 取值：`pull`（只读）、`push`（可推送，组员用这个）、`admin`（可管理设置）。

查看现有协作者：

```bash
gh api repos/ahawzlc/se2026-research-platform/collaborators
```

### 3. 打标签（验收节点）

```bash
git tag -a v0.1 -m "第 1 周：脚手架与最小闭环就绪"
git push origin v0.1
gh release create v0.1 --notes "第 1 周交付"
```

## 六、常见问题

**推送被拒 `Permission denied (publickey)`**
本机公钥没加到 GitHub。执行 `cat ~/.ssh/id_ed25519.pub` 复制内容，贴到 GitHub → Settings → SSH and GPG keys。

**`Connection refused` / 连不上 22 端口**
按第二节第 4 条配置 443 通道。

**提交之后 GitHub 上没有我的头像**
提交用的邮箱没加到 GitHub 账号。Settings → Emails 添加并验证。

**整个文件都变了色（CRLF 问题）**
仓库已用 `.gitattributes` 统一为 LF。若本地仍报换行符警告，检查编辑器是否把行尾设成了 CRLF。

**不小心把 `.env` 提交了**
`.gitignore` 已忽略 `.env`。若不慎提交：立即更换泄露的密码/密钥，再按需清理提交历史，并通知全组。

**把 `node_modules` 加进了暂存区**
`git reset HEAD node_modules` 取消暂存。仓库的 `.gitignore` 已忽略该目录，正常情况下不会出现。
