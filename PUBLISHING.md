# 发布清单（维护者用）

这份文件不会随 tarball 发布，只用于把仓库整理成可公开的状态。

## 1. 发布前检查

```sh
node test/smoke.mjs       # 折叠、分桶边界、序列、配置与落盘归一
node test/accountant.mjs  # 增量折叠、fork 去重、历史回填、重启恢复、裁剪
node test/client.mjs      # 客户端模块加载与设置页 / 图标注册
node --check index.js && node --check service.js && node --check accountant.js
node --check ledger.js && node --check store.js && node --check options.js && node --check client.js
```

- [ ] 版本号与 `CHANGELOG.md` 对应
- [ ] `README.md` / `README.en.md` 与当前界面一致
- [ ] `package.json` 的 `repository` / `homepage` / `bugs` 指向 `skyrocks/dsh-token-stats`
- [ ] `engines.dsh` 与目标 DSH 版本匹配
- [ ] `peerDependencies` 只用真正 import 的包（`react` / `cordis` / `typert-protocol`）
- [ ] `locale/*.json` 的 `meta.detail` 指向 `docs/DETAIL.md`，且 `files` 里有 `docs`

## 2. 本地安装自测

```sh
dsh plugin add /Users/shilei/PrivateCode/dsh/dsh-token-stats
```

装完完全退出 DSH 再打开，进「设置 → Token 用量」：应当先看到回填进度，几秒后出现今日 / 本周 / 本月
和三张图；点「刷新」数字应更新。

## 3. 打包

```sh
pnpm pack     # 生成 skyrocks-dsh-token-stats-0.1.0.tgz
```

## 4. 发布

```sh
git push -u origin main
gh release create v0.1.0 ./skyrocks-dsh-token-stats-0.1.0.tgz --title "v0.1.0" --generate-notes
```

## 5. 更新插件索引

把 tarball 放进 `dsh-plugins/dist/`，在 `index.json` 里加一条 `versions[]`
（`source.commit` 填本次提交 sha），并更新 `README.md` / `README.en.md` 的表格与安装命令。

## 6. 可选：发布到 npm

```sh
npm publish --access public
```

本插件没有运行时依赖，目录直装不需要额外的 `npm install`。
