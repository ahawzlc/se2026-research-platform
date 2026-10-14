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
> 本项目 A 组使用的邮箱是 `wangzl24@mails.tsinghua.edu.cn`。

### 4. 添加并验证邮箱（提交才会关联到你的账号）

提交里的邮箱必须**同时**是 GitHub 账号里已添加**且已验证**的邮箱，否则提交能推上去，但不算你的（头像、贡献图空白）。

**网页操作（推荐，最快）**

1. 打开 https://github.com/settings/emails
2. `Add email address` → 填 `wangzl24@mails.tsinghua.edu.cn` → `Add`
3. 到清华邮箱（https://mails.tsinghua.edu.cn）收 GitHub 的验证邮件 → 点 `Verify email address`
4. 验证通过后，在该邮箱右侧下拉里可设为 **Primary**

**命令行操作（需先给 gh 补 `user` 权限）**

```bash
gh auth refresh -h github.com -s user      # 会再走一次设备码授权
gh api --method POST -H "Accept: application/vnd.github+json" \
  /user/emails -f "emails[]=wangzl24@mails.tsinghua.edu.cn"
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

> **前提：仓库必须是公开库，或账号具有 GitHub Pro / Team / Enterprise。**
>
> **本仓库当前状态：已设为公开库，`main` 分支保护规则已生效**（无需再申请 Pro）。
> 依据：GitHub 官方文档「保护分支在 GitHub Free 下仅公开库可用；公开库与私有库均可用需 Pro 及以上」。
> 已实测：**个人账号下的私有库**调用分支保护与 rulesets 接口，均返回
> `403 Upgrade to GitHub Pro or make this repository public to enable this feature`。
>
> 若将来需要**在私有状态下**使用保护规则，走下面方案 A；想把仓库转回私有，见方案 B 的逆向操作。

**方案 A：领 GitHub Pro（在校生免费）——若要把仓库转回私有，必须走这条**

1. 先完成上面「添加并验证邮箱」，把清华邮箱挂到账号上；
2. 打开 https://education.github.com/discount_requests/application 申请；
3. 身份选 `Student`，学校填 `Tsinghua University`，填学制与预计毕业时间；
   认证方式二选一：① 用学校邮箱（`@mails.tsinghua.edu.cn`，通常可直接通过）；
   ② 上传在读证明 / 学生证（**需含姓名与当前日期**）；
4. 审核一般需数天，通过后个人账号即变为 Pro，私有库的分支保护、CODEOWNERS 等随即可用；
5. 通过后回来找我（或自己跑下面的命令）设置保护规则。

> **关键限制**：个人 Pro 只对**个人账号名下的仓库**生效。若把仓库挪到 GitHub Organization，
> 则必须 Organization 自身有 Team/Enterprise（或由任课教师申请 GitHub Education for teachers
> 免费获得 Team），所以**不要把仓库转移到 organization**。

**方案 B：切换仓库可见性**

- 转公开：Settings → General → 最下方 Danger Zone → `Change visibility` → `Change to public`（当前状态）；
- 转私有：同处选 `Change to private`，**但私有后保护规则会失效**，需先具备 Pro 才谈得上继续用。

**方案 C：暂不启用，先用约定约束**（当前未采用）

本文件的流程（分支 → PR → 评审 → 合并）照样执行，只是**没有服务端强制**，
误推 `main` 不会被拦截。答辩时可说明"因 GitHub Free 对私有库的限制，采用约定 + PR 流程"。

具备前提后，执行：

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
