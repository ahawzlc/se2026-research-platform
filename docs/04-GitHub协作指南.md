# GitHub 协作指南

面向全组的操作手册。前半部分是**每个组员都要做的**，后半部分是**维护者（A 组）才用到的**。

仓库地址：`git@github.com:ahawzlc/se2026-research-platform.git`（**公开库**，`main` 已开启分支保护）
网页地址：https://github.com/ahawzlc/se2026-research-platform

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

### 4. 添加并验证邮箱（提交才会关联到你的账号）

提交里的邮箱必须**同时**是 GitHub 账号里已添加**且已验证**的邮箱，否则提交能推上去，但不算你的（头像、贡献图空白）。

**网页操作（推荐，最快）**

1. 打开 https://github.com/settings/emails
2. `Add email address` → 填**你自己的邮箱**（想关联到 GitHub 账号的那个）→ `Add`
3. 到该邮箱收 GitHub 的验证邮件 → 点 `Verify email address`
4. 验证通过后，在该邮箱右侧下拉里可设为 **Primary**

**命令行操作（需先给 gh 补 `user` 权限）**

```bash
gh auth refresh -h github.com -s user      # 会再走一次设备码授权
gh api --method POST -H "Accept: application/vnd.github+json" \
  /user/emails -f "emails[]=<你的邮箱>"
# 查看结果
gh api /user/emails --jq '.[] | {email, primary, verified, visibility}'
```

> 命令行只能完成"添加"，**验证那一步无论如何都要去邮箱点链接**。

**容易踩的坑**：Settings → Emails 里有一项 `Block command line pushes that expose my email`
（阻止暴露邮箱的命令行推送）。**若勾选，用真实邮箱提交的 push 会被服务端拒绝**（报 `GH007`）。两种解法：

1. 这一项**不要勾**；
2. 想隐藏真实邮箱又要关联账号，就把提交邮箱改成 GitHub 提供的
   `<数字ID>+<用户名>@users.noreply.github.com`（具体地址在 Settings → Emails 页面可见）。

### 5. 网络不通时（本机组情况）

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

> **当前状态：仓库为公开库，`main` 分支保护规则已生效**。
> 依据：GitHub Free 下分支保护仅对**公开库**开放，私有库需 GitHub Pro 及以上。
> 若将来要把仓库转回私有并保留保护规则，需先申请 GitHub Education 的 Pro（在校生免费），
> 再按下方「当前生效配置」重新设置。

当前实际生效的配置：

```bash
gh api -X PUT repos/ahawzlc/se2026-research-platform/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

单项调整（不必重发整份配置）：

```bash
# 例：关闭"新增提交即作废已有批准"
gh api -X PATCH repos/ahawzlc/se2026-research-platform/branches/main/protection/required_pull_request_reviews \
  -F dismiss_stale_reviews=false -F required_approving_review_count=1
```

| 配置项 | 取值 | 说明 |
| --- | --- | --- |
| `required_pull_request_reviews` | 开启，1 人批准 | `main` 只能通过 PR 合入 |
| `dismiss_stale_reviews` | **false** | 关闭。若开启，组员批准后再推一个提交，批准会作废、需重新批准，小组协作过于折腾 |
| `allow_force_pushes` | false | 禁止强推，防止覆盖他人提交 |
| `allow_deletions` | false | 禁止删除 `main` |
| `enforce_admins` | **false** | 管理员不受上述规则约束，便于应急；代价是管理员可直推 `main` |

> **管理员的限制**：开启保护后，管理员**无法批准自己发起的 PR**。
> 在还没有其他协作者的阶段，只能用管理员权限绕过：
> `gh pr merge <编号> --merge --admin`，或网页上勾选
> `Merge without waiting for requirements to be met`。
>
> **`develop` 合入 `main` 的合并策略**：长期分支 `develop` 合入 `main` 用 **merge commit**
> （`gh pr merge --merge`），**不要 squash、不要删 `develop` 分支**——否则两边历史分叉，后续 PR 会反复冲突。

查看当前保护规则：

```bash
gh api repos/ahawzlc/se2026-research-platform/branches/main/protection
```

网页等价操作：Settings → Branches → `Add branch protection rule` → Branch name pattern 填 `main`
→ 勾 `Require a pull request before merging` → `Required approvals` 设 1 → Create。
（`enforce_admins: false` 的含义是：规则默认不约束仓库管理员，管理员仍可直接推送，便于应急。）

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
