# effect-poc

## source

https://github.com/IMax153/advanced-effect-workshop/blob/main/workshop/solutions/session-01/project/advanced.ts

https://gist.github.com/mikearnaldi/cd96146054b79eea62e2e2dd2409c49d

## How

```shell
mkdir effect-poc

cd effect-poc

npx gts@latest init

echo "function gi() { curl -sLw \"\\\n\" https://www.toptal.com/developers/gitignore/api/\$@ ;}" >> \
~/.zshrc && source ~/.zshrc

gi node,macos,osx,visualstudiocode > .gitignore
```

modify `tsconfig.json`

```json
// "noEmit": true,
"noErrorTruncation": true,
```
