/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板
 *
 * 实现要点：挂载于 `#extensions_settings2`；`inline-drawer` 折叠由宿主 jQuery 处理；
 * 帮助入口使用 `fa-circle-question` 与 `callGenericPopup`；样式经 teleport 写入宿主 `<head>`。
 *
 * H-1 独立面板：
 *   1. 使用指南按钮
 *   2. 操作按钮 × 5（完整文本，不缩写）
 *   3. 设置区域（通知等级 + 自动从开场白初始化 + 容错阈值 + 楼层变量生命周期）
 *
 * H-2 魔棒快捷按钮 × 2：
 *   - 重新解析当前楼层
 *   - 设置变量检查点
 */

import * as notify from './notification.js';
import { readVariables, writeVariables } from './variable-store.js';
import { VARUPDATE_CONFIG_KEY, type NotifyLevel } from '../types/index.js';

// ═══════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════

const PANEL_ROOT_ID = 'varupdate-settings';
const TELEPORTED_STYLE_ID = 'varupdate-teleported-style';
const WAND_IDS = ['varupdate-wand-reparse', 'varupdate-wand-checkpoint'] as const;

// ═══════════════════════════════════════════
//  获取宿主文档
// ═══════════════════════════════════════════

function getHostDocument(): Document {
  try {
    return window.parent?.document || document;
  } catch {
    return document;
  }
}

// ═══════════════════════════════════════════
//  帮助弹窗（HTML，供 callGenericPopup / toastr / alert 回退）
// ═══════════════════════════════════════════

const HELP: Record<string, { title: string; content: string; wide?: boolean; large?: boolean }> = {
  guide: {
    title: '📖 变量系统使用指南',
    wide: true,
    large: true,
    content: `<div style="display: flex; flex-direction: row; gap: 20px; text-align: left; line-height: 1.6; font-size: 0.95em; max-height: 85vh; overflow-y: auto; padding-right: 5px;">
  
  <!-- 左列：世界书与消息指令 -->
  <div style="flex: 1;">
    <h3 style="margin-top: 0; border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); padding-bottom: 6px;">1. 世界书声明 (基础设置)</h3>
    无论是 Schema 还是 Default，均支持 JSON、YAML、TOML 三种格式的解析。<span style="color:var(--SmartThemeHintColor, #888);">为了防止污染提示词，请在世界书管理界面将其设为“禁用”，脚本解析仍能够解析。</span><br>

    <p><b>1.1 格式定义 [Var_Schema]</b><br>
    在世界书的条目标题中加入 <code>[Var_Schema]</code>标签，使用专有语法定义变量的结构和校验规则。脚本会自动将其编译为 Zod 代码执行。</p>
    
    <p style="margin: 5px 0 2px 0; font-size: 0.9em;"><b>① 支持的类型 ($type)</b></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 2px; font-size: 0.85em; text-align: left;">
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px; width: 33%;"><code>string</code> / <code>number</code> / <code>integer</code> / <code>boolean</code></td>
        <td style="padding: 4px;">基础的文本、数值、整数、布尔值。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>string/number/integer</code> + <code>(force)</code></td>
        <td style="padding: 4px;">可在常见输出偏差（如数字被写成字符串，或输出为违规小数）下仍尽量通过校验并归一化为目标类型。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>object</code></td>
        <td style="padding: 4px;">固定结构对象，大部分父节点均为此类，允许在内部逐一定义子节点。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>array&lt;type&gt;</code> / <code>record&lt;type&gt;</code></td>
        <td style="padding: 4px;">数组容器与字典容器，其中 <code>type</code> 为存放的元素类型（例如 <code>array&lt;string&gt;</code>）。</td>
      </tr>
    </table>

    <p style="margin: 10px 0 2px 0; font-size: 0.9em;"><b>② 其他语法与约束</b></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 2px; font-size: 0.85em; text-align: left;">
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$defs</code></td>
        <td style="padding: 4px;">定义可复用的自定义类型来允许复杂规则，必须位于Schema的最顶部。详情见示例包。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px; width: 33%;"><code>$enum</code></td>
        <td style="padding: 4px;">控制string的范围边界，可与通配符规则配合（见附录）。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$min</code> / <code>$max</code></td>
        <td style="padding: 4px;">控制number或integer的范围边界。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$minLength</code> / <code>$maxLength</code></td>
        <td style="padding: 4px;">控制string的文本字符长度上下限。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$minItems</code> / <code>$maxItems</code></td>
        <td style="padding: 4px;">控制array或record的元素数量上限。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$regex</code></td>
        <td style="padding: 4px;">利用正则表达式强制约束string的格式规范。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$key_rule</code></td>
        <td style="padding: 4px;">record专属规则，允许作为父项容纳其他子规则节点，并将这些规则作用于record的键名。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$either</code></td>
        <td style="padding: 4px;">通用父项规则节点，其下以数组形式容纳多组子规则，满足任意一组即通过校验。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$optional</code></td>
        <td style="padding: 4px;">为true时允许该属性被置空（可以处于缺失状态不去校验）。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$default</code></td>
        <td style="padding: 4px;">当数据缺失时，自动为该属性赋予一个安全的默认底值。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>refer(...)</code></td>
        <td style="padding: 4px;">引用另一变量当前真实值作约束（如 <code>$max: refer(HP上限)</code>）。</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>$extensible</code></td>
        <td style="padding: 4px;">为true时允许该对象额外新增未经定义的新增项。</td>
      </tr>
      <tr>
        <td style="padding: 4px;"><code>$hide</code></td>
        <td style="padding: 4px;">为true时会使该节点（及子节点）在使用插值占位符进行范围提取时被忽略。不过若是你直接指定该节点或是该节点的子节点，其依然会被替换为实际值。</td>
      </tr>
    </table>

    <p style="margin-top: 15px;"><b>1.2 默认底值 [Var_Default]</b><br>
    在世界书的条目标题中加入 <code>[Var_Default]</code>标签。此处定义的默认值会覆盖 Schema 中的 $default，便于集中定义和整理。当 <code>&lt;Var_Initial&gt;</code> 定义的初始变量有遗漏时，系统会自动用这里的数据进行补齐。</p>

    <h3 style="margin-top: 20px; border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); padding-bottom: 6px;">2. 消息流指令 (AI 或玩家输出)</h3>

    <p><b>2.1 初始化 &lt;Var_Initial&gt;</b><br>
    用于在开场白设置或在故事中重置剧情状态。它会<b>完全清空当前的变量</b>，根据解析结果重新建立初始状态。<span style="color:var(--SmartThemeHintColor, #888);">同样支持JSON、YAML、TOML三种格式。</span></p>

    <p><b>2.2 动态更新 &lt;Var_Update&gt;</b><br>
    在聊天过程中输出，用来<b>修改现有的变量</b>，支持替换（<code>replace</code>）、新增（<code>insert</code>，路径末尾写 <code>/-</code> 代表加到数组末尾）、删除（<code>delete</code>）三种操作。针对大语言模型输出的不稳定性，引擎额外<b>特化了容错机制</b>：<br>
    <span style="font-size: 0.9em; display: block; margin-top: 4px;">
    • <b>格式适应：</b>针对字符串中出现未转义双引号或整体缺失部分括号的错误，引擎会从每行的首位双向解析并尝试为引号/括号配对，以解决传统单向解析导致的深度匹配错误；<br>
    • <b>路径适应：</b>针对大语言模型输出错误或不完整路径的问题，引擎会尝试从右向左反向解析，对照键名使用排除法尝试找到唯一对象。<br>
    </span></p>

    <!-- 综合示例导览框 -->
    <div style="margin-top: 20px; padding: 12px; background: var(--blackA70, rgba(0,0,0,0.1)); border: 1px dashed var(--SmartThemeBorderColor, #ccc); border-radius: 6px; text-align: center;">
      <p style="margin: 0 0 8px 0; font-size: 0.95em;">📚 <b>查看完整的配套示例包</b></p>
      <div style="font-size: 0.85em; color: var(--SmartThemeHintColor, #ccc); margin-bottom: 10px;">
        一套现代恋爱背景的 Schema / Default / Initial / Update 空模板
      </div>
      
      <a href="https://github.com/LieYangZhirun/VarUpdate/tree/main/examples" target="_blank" rel="noopener noreferrer" title="VarUpdate 仓库 · examples 目录" style="display: inline-block; color: var(--SmartThemeBodyColor, #fff); background: #24292e; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 0.85em;">
        <i class="fa-brands fa-github"></i> GitHub 示例包
      </a>
    </div>
  </div>
  
  <!-- 中间分割线 -->
  <div style="width: 1px; background: var(--SmartThemeBorderColor, #ccc); flex-shrink: 0;"></div>

  <!-- 右列：宏与条件 -->
  <div style="flex: 1;">
    <h3 style="margin-top: 0; border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); padding-bottom: 6px;">3. 插值占位符</h3>
    <p><b>3.1 提取变量值与插入</b><br>
    你可以在预设、角色卡、世界书的任意位置插入<code>{{message/data/具体路径}}</code>这样的占位符，脚本会自动根据变量路径提取叶子节点的具体值，或范围提取父节点的结构并转化为“PromptalYAML”——一种极度节约 Token 的设定专用格式。<br>
    <span style="color:var(--SmartThemeHintColor, #888); font-size: 0.9em;">*插值占位符的路径解析同样采用了<b>从右向左反向解析的方法</b>：若是路径太长，可以在<code>data/</code>后直接写末尾的具体路径，略过中间部分。</span></p>

    <p><b>3.2 获取更新记录</b><br>
    通过 <code>{{message/log}}</code>，你可以将最新楼层的变量更新日志单独提取出来（如 <code>角色/HP: 80 → 75</code>）做单独展示。</p>
    
    <h3 style="margin-top: 20px; border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); padding-bottom: 6px;">4. 变量条件标签 (动态开关)</h3>
    <p>把中括号 <code>[]</code> 放在预设名称、世界书备注、正则等名字的两边，<b>只有里面的条件成真时，这条设定才会被设为启用发送</b>。</p>

    <p style="margin: 5px 0 2px 0; font-size: 0.9em;"><b>4.1 值运算</b> <span style="color:var(--SmartThemeHintColor, #888);">（支持附录中的通配符规则）</span></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 2px; font-size: 0.85em; text-align: left;">
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); background: var(--blackA70, rgba(0,0,0,0.1));">
        <th style="padding: 4px; width: 15%;">运算符</th>
        <th style="padding: 4px; width: 45%;">规则描述</th>
        <th style="padding: 4px; width: 40%;">配置示例</th>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>==</code> / <code>!=</code></td><td style="padding: 4px;">宽松相等 / 不等</td><td style="padding: 4px;"><code>["当前地点" == "学校天台"]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>===</code> / <code>!==</code></td><td style="padding: 4px;">严格相等 / 严格不等 (要求数据类型一致)</td><td style="padding: 4px;"><code>["林夏/玩家好感度" === 50]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>&gt;</code> / <code>&gt;=</code> / <code>&lt;</code> / <code>&lt;=</code></td><td style="padding: 4px;">数值比较</td><td style="padding: 4px;"><code>["玩家/金钱" &lt; 300]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>∋</code> / <code>∌</code></td><td style="padding: 4px;">数组含 / 不含某个值</td><td style="padding: 4px;"><code>["玩家/物品栏" ∋ "草莓牛奶"]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>⊇</code> / <code>!⊇</code></td><td style="padding: 4px;">对象含 / 不含某个键</td><td style="padding: 4px;"><code>["玩家/状态" ⊇ "心跳加速"]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>#</code></td><td style="padding: 4px;">计算长度后再进行比较</td><td style="padding: 4px;"><code>["玩家/物品栏" # &lt; 5]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;"><code>?</code> / <code>!?</code></td><td style="padding: 4px;">检查变量是否已被创建(已赋过值)</td><td style="padding: 4px;"><code>["情书" ?]</code></td></tr>
      <tr><td style="padding: 4px;"><code>$</code> (加在键名前)</td><td style="padding: 4px;">用来与另一个动态变量的当前值做比较</td><td style="padding: 4px;"><code>["xxx价格" &gt; $"玩家/金钱"]</code></td></tr>
    </table>

    <p style="margin: 15px 0 2px 0; font-size: 0.9em;"><b>4.2 逻辑运算</b></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 2px; font-size: 0.85em; text-align: left;">
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); background: var(--blackA70, rgba(0,0,0,0.1));">
        <th style="padding: 4px; width: 15%;">运算符</th>
        <th style="padding: 4px; width: 45%;">规则描述</th>
        <th style="padding: 4px; width: 40%;">配置示例</th>
      </tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;">AND (与)</td><td style="padding: 4px;">多个方括号并排连写。全部满足才生效。</td><td style="padding: 4px;"><code>["角色列表/陈秋/玩家好感度" &gt; 50]["当前地点" == "天台"]</code></td></tr>
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc);"><td style="padding: 4px;">OR (或)</td><td style="padding: 4px;">在同一个方括号内用 <code>|</code> 隔开，满足其一即可。</td><td style="padding: 4px;"><code>["当前天气" == "下雨" | "当前时间/星期" == "周日"]</code></td></tr>
      <tr><td style="padding: 4px;">NOT (非)</td><td style="padding: 4px;">首位加 <code>!</code> 直接反转该条件。</td><td style="padding: 4px;"><code>[!"陈秋/当前情绪" == "愤怒"]</code></td></tr>
    </table>

    <p style="margin: 15px 0 2px 0; font-size: 0.9em;"><b>4.3 组合具体示例</b></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 2px; font-size: 0.85em; text-align: left;">
      <tr style="border-bottom: 1px solid var(--SmartThemeBorderColor, #ccc); background: var(--blackA70, rgba(0,0,0,0.1));">
        <th style="padding: 4px; width: 55%;">条目标题</th>
        <th style="padding: 4px; width: 45%;">规则解读</th>
      </tr>
      <tr style="border-bottom: 1px dashed var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>["当前地点" == "天台"]["好感度" &gt; 20]特殊午餐事件</code></td>
        <td style="padding: 4px;">不仅要在学校“天台”，且对象好感度大于20时才会触发。</td>
      </tr>
      <tr style="border-bottom: 1px dashed var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>["玩家/物品栏" ∋ "情书"|"星期" == "周五"]告白冲动</code></td>
        <td style="padding: 4px;">只要玩家带着“情书”，或者是恰好碰上容易冲动的“周五”，都会激活该状态设定。</td>
      </tr>
      <tr style="border-bottom: 1px dashed var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>[!"玩家/状态标记" ⊇ "生病"]["金钱" &gt; 100]解锁周末约会</code></td>
        <td style="padding: 4px;">需要玩家没有“生病”，并且“金钱”足够花销，才会解锁周末约会。</td>
      </tr>
      <tr style="border-bottom: 1px dashed var(--SmartThemeBorderColor, #ccc);">
        <td style="padding: 4px;"><code>["陈秋/玩家好感度" &lt;= $"林夏/玩家好感度"]陈秋的心态:默默祝愿</code></td>
        <td style="padding: 4px;">实时比较两个变量值，根据人际动态决定角色行为模式。</td>
      </tr>
      <tr>
        <td style="padding: 4px;"><code>["角色列表/***/状态标记" ⊇ "中毒"]中毒解法</code></td>
        <td style="padding: 4px;"><b>群查：</b>使用三星号代表完全任意匹配。只要队伍里有<b>任何一个</b>对象的标记包含中毒，即判定生效。</td>
      </tr>
    </table>

    <!-- 附录：通配符 -->
    <div style="margin-top: 25px; padding: 10px; border-radius: 6px; background: var(--blackA70, rgba(0,0,0,0.1)); border: 1px dashed var(--SmartThemeBorderColor, #ccc);">
      <h4 style="margin: 0 0 6px 0; font-size: 0.95em;">附录：通配符 <code>*</code></h4>
      <p style="margin: 0; font-size: 0.85em; color: var(--SmartThemeHintColor, #888);">
      通配符可用于右侧的值比对运算，也可直接用于<b>左侧的动态路径群查</b>中（见上方 4.3 示例）。<br>
      • **个数匹配**：<code>1~2</code>个星号代表<b>严格的一字一配</b>。<code>3</code>个及其以上星号(如 <code>***</code>)可以忽略前导或后随长度，匹配任意长的内容。如果当作常规的"全部包含"通配符用，请一定写三个星！<br>
      • **位置匹配**：<code>*</code>号可出现在开头、结尾或中间。示例：<code>["地点" == "***森林***"]</code> 匹配“原始森林外围”。<br>
      • **路径群查**：如 <code>["背包/***宝石/数量" > 0]</code> 会去遍历背包内所有以宝石结尾的物品，当找出多个时采用<b>隐式群查机制</b>——只要有任意一项满足要求（数量大于0），整条语句就判为真。
      </p>
    </div>
  </div>
</div>`,
  },
  notifyLevel: {
    title: '🔔 通知等级',
    content: `控制变量系统弹出通知（toastr）和控制台日志的信息级别：<br><br>
<table style="width:100%; border-collapse:collapse;">
<tr><td style="padding:4px;"><b>debug</b></td><td style="padding:4px;">显示所有信息：调试细节 + 成功 + 警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>always</b></td><td style="padding:4px;">显示操作结果：成功 + 警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>notice</b></td><td style="padding:4px;">（默认）仅显示需要注意的：警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>error</b></td><td style="padding:4px;">仅显示错误</td></tr>
<tr><td style="padding:4px;"><b>silence</b></td><td style="padding:4px;">完全静默，不弹出任何通知</td></tr>
</table><br>
💡 日常使用建议 <b>notice</b>；调试问题时切换为 <b>debug</b>。`,
  },
  autoInit: {
    title: '⚡ 自动从开场白初始化',
    content: `<b>开启（推荐）：</b><br>
新建聊天或切换聊天时，脚本会自动扫描开场白中的 <code>&lt;Var_Initial&gt;</code> 标签并执行变量初始化，无需手动操作。<br><br>
<b>关闭：</b><br>
不会自动初始化，你需要手动点击面板上的「从开场白重新初始化」按钮来触发。<br><br>
💡 大多数情况下建议保持开启。如果你的角色卡不需要开场白初始化（比如只在后续消息中写 Update），可以关闭。`,
  },
  toleranceThreshold: {
    title: '🎯 容错阈值',
    content: `与Agents系统配合使用，根据一次变量更新中的「无效指令数」决定是否自动重试：<br><br>
当 AI 输出的 <code>&lt;Var_Update&gt;</code> 中有部分指令无效时：<br>
• 无效数 <b>≤ 阈值</b> → 视为<b>警告</b>：变量正常更新，但会通知你检查<br>
• 无效数 <b>&gt; 阈值</b> → 视为<b>失败</b>：广播失败事件，可触发 Agents 自动重试<br><br>
<b>建议值：</b><br>
• <b>2</b>（默认）— 适合大多数场景，容忍少量格式错误<br>
• <b>0</b> — 严格模式，任何指令无效都视为失败<br>
• <b>5+</b> — 宽松模式，适合变量字段多、AI 容易犯错的场景`,
  },
  varLifecycle: {
    title: '📦 楼层变量生命周期',
    content: `控制保留最近多少层消息的完整变量数据：<br><br>
• 超出范围的旧楼层变量会被自动清理，以控制内存占用<br>
• 被标记为<b>检查点</b>的楼层<b>始终保留</b>，不受清理影响<br>
• 清理只删除变量数据，<b>不影响消息内容</b><br><br>
<b>建议值：</b><br>
• <b>20</b>（默认）— 适合大多数场景<br>
• <b>50+</b> — 如果你经常回看历史变量<br>
• <b>9999</b> — 几乎不清理（会很卡）`,
  },
};

function showHelp(key: string): void {
  const h = HELP[key];
  if (!h) return;
  try {
    // SillyTavern 是酒馆助手注入到 iframe 的直接全局变量
    const ST = (globalThis as any).SillyTavern;
    if (ST?.callGenericPopup) {
      ST.callGenericPopup(h.content, ST.POPUP_TYPE.TEXT, '', {
        wide: h.wide ?? false, large: h.large ?? false, okButton: '了解', cancelButton: false,
      });
      return;
    }
  } catch { /* fallback */ }
  // fallback to toastr
  try {
    const t = (globalThis as any).toastr;
    if (t?.info) {
      t.info(h.content.replace(/<[^>]+>/g, ''), h.title, { timeOut: 10000, closeButton: true });
      return;
    }
  } catch { /* fallback */ }
  alert(`${h.title}\n\n${h.content.replace(/<[^>]+>/g, '')}`);
}

// ═══════════════════════════════════════════
//  面板样式（`.varupdate-*`，teleport 到宿主 head）
// ═══════════════════════════════════════════

const PANEL_CSS = `
.varupdate-button-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 10px;
}
.varupdate-btn {
  background-color: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 5px;
  padding: 5px 10px;
  text-align: center;
  cursor: pointer;
  flex: 1 1 45%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 0.9em;
  transition: background-color 0.2s;
}
.varupdate-btn:hover {
  background-color: var(--SmartThemeHoverColor);
}
.varupdate-button-grid .varupdate-btn:nth-child(n+3) {
  flex: 1 1 30%;
}
.varupdate-settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 5px;
}
.varupdate-settings-grid .varupdate-setting-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.varupdate-settings-grid label {
  white-space: nowrap;
  font-size: 0.9em;
}
.varupdate-settings-grid .varupdate-compact-pole {
  width: 6rem;
  flex-shrink: 0;
}
.varupdate-help-icon {
  cursor: pointer;
  margin-left: 3px;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.varupdate-help-icon:hover {
  opacity: 1;
}
.varupdate-setting-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
}
`;

// ═══════════════════════════════════════════
//  面板 HTML
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>变量系统</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

    <!-- 顶部快捷按钮区 -->
    <div class="varupdate-button-grid">
      <div class="varupdate-btn" id="varupdate-btn-reload" title="功能：从世界书重新读取并编译格式规则，覆盖旧规则。&#10;适用：当你刚修改了字段格式又遇到校验报错时。&#10;注意：不影响任何已有历史楼层。">
        <i class="fa-solid fa-arrows-rotate"></i> 重新加载格式规则
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reinit" title="功能：重新扫描开场白中的 <Var_Initial> 标签。&#10;适用：你手动修改了开场白变量或初始化失败想重启时。&#10;注意：仅清空开场白并重建，不影响中间楼层更新。">
        <i class="fa-solid fa-file-import"></i> 从开场白重新初始化
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse" title="功能：清除最新楼层的变量数据，对该层重新扫描标签并更新。&#10;适用：你刚手动编辑了最新消息中的标签，想让它生效。&#10;注意：仅能处理最高一层的单层错误。">
        <i class="fa-solid fa-rotate-right"></i> 重新解析当前楼层
      </div>
      <div class="varupdate-btn" id="varupdate-btn-checkpoint" title="功能：将当前最新楼层永久标记为“检查点”。&#10;适用：到达关键剧情节点，将其标记为存档锚点。&#10;原理：存档锚点永远免受生命周期清理，且可作链式修复的起点。">
        <i class="fa-solid fa-camera"></i> 将当前楼层设为检查点
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse-chain" title="功能：从最近的检查点向下逐一重跑所有楼层的变量更新。&#10;适用：变量全乱了，需要基于锚点进行覆盖性重算修复。">
        <i class="fa-solid fa-play"></i> 从检查点逐层重新解析
      </div>
    </div>

    <div class="varupdate-btn" id="varupdate-btn-guide" title="查看变量系统的完整使用说明" style="margin-bottom:10px;">
      <i class="fa-solid fa-book-open"></i> 使用指南
    </div>

    <hr />

    <!-- 设置区域 (2x2 grid) -->
    <div class="varupdate-settings-grid">
      <div class="varupdate-setting-item">
        <label for="varupdate-notify-level">通知等级</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-notify"></i>
        <select id="varupdate-notify-level" class="text_pole varupdate-compact-pole">
          <option value="debug">debug</option>
          <option value="always">always</option>
          <option value="notice" selected>notice</option>
          <option value="error">error</option>
          <option value="silence">silence</option>
        </select>
      </div>
      <div class="varupdate-setting-item">
        <label>自动从开场白初始化</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-autoinit"></i>
        <input id="varupdate-auto-init" type="checkbox" checked />
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-tolerance">容错阈值</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-tolerance"></i>
        <input id="varupdate-tolerance" type="number" class="text_pole varupdate-compact-pole" min="0" max="99" step="1" value="2" />
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-lifecycle">楼层变量生命周期</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-lifecycle"></i>
        <input id="varupdate-lifecycle" type="number" class="text_pole varupdate-compact-pole" min="1" max="9999" step="1" value="20" />
        <span style="opacity:0.5; font-size:0.85em;">层</span>
      </div>
    </div>

  </div>
</div>
`;

// ═══════════════════════════════════════════
//  回调容器
// ═══════════════════════════════════════════

interface PanelCallbacks {
  onReloadRules?: () => void;
  onReinitFromGreeting?: () => void;
  onReparseFloor?: () => void;
  onSetCheckpoint?: () => void;
  onReparseFromCheckpoint?: () => void;
}

let callbacks: PanelCallbacks = {};

// ═══════════════════════════════════════════
//  样式插入宿主文档
// ═══════════════════════════════════════════

function teleportStyle(): void {
  try {
    const hostDoc = getHostDocument();
    if (hostDoc.getElementById(TELEPORTED_STYLE_ID)) return;

    const styleEl = hostDoc.createElement('style');
    styleEl.id = TELEPORTED_STYLE_ID;
    styleEl.textContent = PANEL_CSS;
    hostDoc.head.appendChild(styleEl);
  } catch { /* 静默 */ }
}

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

export function renderPanel(cbs: PanelCallbacks = {}): void {
  callbacks = cbs;

  try {
    const hostDoc = getHostDocument();
    if (hostDoc.getElementById(PANEL_ROOT_ID)) return;

    // 传送样式到宿主 <head>
    teleportStyle();

    const container = hostDoc.getElementById('extensions_settings2')
      || hostDoc.getElementById('extensions_settings');
    if (!container) {
      notify.debug('面板', '#extensions_settings2 未找到', { category: 'ui' });
      return;
    }

    const wrapper = hostDoc.createElement('div');
    wrapper.innerHTML = PANEL_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (panel) container.appendChild(panel);

    // ─── 不手动绑定 inline-drawer toggle ───
    // SillyTavern 宿主的 jQuery 自动处理 inline-drawer 折叠逻辑

    // 操作按钮
    bind(hostDoc, 'varupdate-btn-guide', () => showHelp('guide'));
    bind(hostDoc, 'varupdate-btn-reload', () => callbacks.onReloadRules?.());
    bind(hostDoc, 'varupdate-btn-reinit', () => callbacks.onReinitFromGreeting?.());
    bind(hostDoc, 'varupdate-btn-reparse', () => callbacks.onReparseFloor?.());
    bind(hostDoc, 'varupdate-btn-checkpoint', () => callbacks.onSetCheckpoint?.());
    bind(hostDoc, 'varupdate-btn-reparse-chain', () => callbacks.onReparseFromCheckpoint?.());

    // 帮助图标
    bind(hostDoc, 'varupdate-help-notify', () => showHelp('notifyLevel'));
    bind(hostDoc, 'varupdate-help-autoinit', () => showHelp('autoInit'));
    bind(hostDoc, 'varupdate-help-tolerance', () => showHelp('toleranceThreshold'));
    bind(hostDoc, 'varupdate-help-lifecycle', () => showHelp('varLifecycle'));

    // 设置项变更
    hostDoc.getElementById('varupdate-notify-level')?.addEventListener('change', (e) => {
      const level = (e.target as HTMLSelectElement).value as NotifyLevel;
      notify.setLevel(level);
      saveSettings(hostDoc);
    });
    hostDoc.getElementById('varupdate-auto-init')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-tolerance')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-lifecycle')?.addEventListener('change', () => saveSettings(hostDoc));

    loadSettings(hostDoc);

  } catch (e) {
    notify.warning('面板', `渲染失败: ${(e as Error).message}`, { category: 'ui' });
  }
}

/**
 * 卸载时移除设置面板、魔棒注入项及 teleport 的 `<style>`。
 */
export function destroyPanel(): void {
  try {
    const hostDoc = getHostDocument();

    const panel = hostDoc.getElementById(PANEL_ROOT_ID);
    panel?.remove();

    for (const id of WAND_IDS) {
      hostDoc.getElementById(id)?.remove();
    }

    hostDoc.getElementById(TELEPORTED_STYLE_ID)?.remove();

    callbacks = {};
  } catch {
    // 卸载时宿主可能已不可用
  }
}

/**
 * H-2：在 `#extensionsMenu` 中注入两条魔棒菜单项（结构与宿主列表项一致）。
 */
export function registerWandButtons(): void {
  try {
    const hostDoc = getHostDocument();
    const menu = hostDoc.getElementById('extensionsMenu');
    if (!menu) {
      notify.debug('魔棒', '#extensionsMenu 未找到', { category: 'ui' });
      return;
    }

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-reparse',
      icon: 'fa-solid fa-rotate-right',
      label: '重新解析当前楼层',
      onClick: () => callbacks.onReparseFloor?.(),
    });

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-checkpoint',
      icon: 'fa-solid fa-camera',
      label: '设置变量检查点',
      onClick: () => callbacks.onSetCheckpoint?.(),
    });

  } catch (e) {
    notify.debug('魔棒', `注册失败: ${(e as Error).message}`, { category: 'ui' });
  }
}

/** 与 HTML input 的 min/max 一致，避免 NaN 或越界写入 global */
function readClampedPanelNumbers(hostDoc: Document): { discardThreshold: number; retentionDepth: number } {
  let discardThreshold = parseInt((hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement)?.value || '2', 10);
  if (!Number.isFinite(discardThreshold) || discardThreshold < 0) discardThreshold = 2;
  if (discardThreshold > 99) discardThreshold = 99;

  let retentionDepth = parseInt((hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement)?.value || '20', 10);
  if (!Number.isFinite(retentionDepth) || retentionDepth < 1) retentionDepth = 20;
  if (retentionDepth > 9999) retentionDepth = 9999;

  return { discardThreshold, retentionDepth };
}

/**
 * 读取面板中的设置值
 */
export function getPanelSettings(): {
  autoInitialize: boolean;
  discardThreshold: number;
  retentionDepth: number;
} {
  try {
    const hostDoc = getHostDocument();
    const { discardThreshold, retentionDepth } = readClampedPanelNumbers(hostDoc);
    return {
      autoInitialize: (hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement)?.checked ?? true,
      discardThreshold,
      retentionDepth,
    };
  } catch {
    return { autoInitialize: true, discardThreshold: 2, retentionDepth: 20 };
  }
}

/** 将当前 message `data` 快照交给通知系统（受通知等级约束，见 `logStateSnapshot`）。 */
export function refreshDebugState(data: Record<string, any>): void {
  notify.logStateSnapshot(data);
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function bind(doc: Document, id: string, handler: () => void): void {
  doc.getElementById(id)?.addEventListener('click', handler);
}

function addWandMenuItem(
  menu: HTMLElement,
  doc: Document,
  opts: { id: string; icon: string; label: string; onClick: () => void }
): void {
  if (doc.getElementById(opts.id)) return;

  const container = doc.createElement('div');
  container.className = 'extension_container';
  container.id = opts.id;

  const item = doc.createElement('div');
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.role = 'listitem';
  item.addEventListener('click', opts.onClick);

  const icon = doc.createElement('div');
  icon.className = `fa-fw ${opts.icon} extensionsMenuExtensionButton`;

  const span = doc.createElement('span');
  span.textContent = opts.label;

  item.appendChild(icon);
  item.appendChild(span);
  container.appendChild(item);
  menu.appendChild(container);
}

function loadSettings(hostDoc: Document): void {
  try {
    const globalData = readVariables('global');
    const s = globalData[VARUPDATE_CONFIG_KEY];
    if (!s) return;

    if (s.notifyLevel) {
      notify.setLevel(s.notifyLevel);
      const sel = hostDoc.getElementById('varupdate-notify-level') as HTMLSelectElement;
      if (sel) sel.value = s.notifyLevel;
    }
    if (s.autoInitialize !== undefined) {
      const cb = hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement;
      if (cb) cb.checked = s.autoInitialize;
    }
    if (s.discardThreshold !== undefined) {
      const inp = hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement;
      if (inp) inp.value = String(s.discardThreshold);
    }
    if (s.retentionDepth !== undefined) {
      const inp = hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement;
      if (inp) inp.value = String(s.retentionDepth);
    }
  } catch { /* 首次使用 */ }
}

function saveSettings(hostDoc: Document): void {
  try {
    // 使用 updateVariablesWith 保证原子性读-改-写
    const option = { type: 'global' as const };
    const { discardThreshold, retentionDepth } = readClampedPanelNumbers(hostDoc);
    const tolInp = hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement;
    const lifeInp = hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement;
    if (tolInp) tolInp.value = String(discardThreshold);
    if (lifeInp) lifeInp.value = String(retentionDepth);

    const cfg = {
      notifyLevel: notify.getLevel(),
      autoInitialize: (hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement)?.checked ?? true,
      discardThreshold,
      retentionDepth,
    };

    if (typeof updateVariablesWith === 'function') {
      updateVariablesWith((globalData) => {
        globalData[VARUPDATE_CONFIG_KEY] = cfg;
        return globalData;
      }, option);
    } else {
      const globalData = readVariables('global');
      globalData[VARUPDATE_CONFIG_KEY] = cfg;
      writeVariables('global', globalData);
    }
  } catch { /* 静默 */ }
}
