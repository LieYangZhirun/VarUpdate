VarUpdate 内嵌库（esbuild / tsc / vitest 均指向本目录下各包的 src）

推荐用法：Git 子模块（仓库均为你在 GitHub 上的项目时）

  cd VarUpdate/vendor
  git submodule add <你的仓库 URL> promptal-yaml
  git submodule add <你的仓库 URL> schema-to-zod
  git submodule add <你的仓库 URL> flexible-json-patch

要求：各仓库根目录下仍有 src/index.ts（与当前路径一致）。

他人克隆含子模块的仓库后：

  git submodule update --init --recursive

若不用子模块：也可将三个仓库直接克隆或复制到本目录同名文件夹下，保持 vendor/<库名>/src/index.ts 结构即可。
