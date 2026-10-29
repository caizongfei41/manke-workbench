# 生成两份图文 PDF 教程
#
#   python scripts/make-docs-pdf.py
#
# 产出：
#   docs/漫客工作台-部署安装教程.pdf
#   docs/漫客工作台-使用教程.pdf
#
# 用 reportlab 而不是浏览器打印：这台机器上没装 Edge/Chrome，
# 夸克客户端也不支持 headless 打印，所以直接用 Python 画 PDF。

import os
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(r"C:\Users\Administrator\Desktop\ComfyUI无线画布")
DOCS = ROOT / "docs"
SHOTS = ROOT / ".verify" / "shots"
VERIFY = ROOT / ".verify"

ACCENT = colors.HexColor("#0891B2")
ACCENT_LIGHT = colors.HexColor("#ECFEFF")
TEXT = colors.HexColor("#18181B")
MUTED = colors.HexColor("#71717A")
BORDER = colors.HexColor("#E4E4E7")
BG_SOFT = colors.HexColor("#FAFAFA")
WARN_BG = colors.HexColor("#FEF3C7")
WARN_BAR = colors.HexColor("#F59E0B")
DANGER_BG = colors.HexColor("#FEE2E2")
DANGER_BAR = colors.HexColor("#EF4444")
NOTE_BG = colors.HexColor("#ECFEFF")

# ── 字体：微软雅黑做正文，黑体做标题（雅黑的小字号更清晰）
FONT_DIR = Path(r"C:\Windows\Fonts")
pdfmetrics.registerFont(TTFont("YaHei", str(FONT_DIR / "msyh.ttc")))
pdfmetrics.registerFont(TTFont("YaHeiBold", str(FONT_DIR / "msyhbd.ttc")))
pdfmetrics.registerFont(TTFont("SimHei", str(FONT_DIR / "simhei.ttf")))
from reportlab.pdfbase.pdfmetrics import registerFontFamily  # noqa: E402

registerFontFamily("YaHei", normal="YaHei", bold="YaHeiBold", italic="YaHei", boldItalic="YaHeiBold")


def make_styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", fontName="YaHeiBold", fontSize=24, leading=32,
            textColor=colors.HexColor("#0F172A"), spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", fontName="YaHei", fontSize=11, leading=18,
            textColor=MUTED, spaceAfter=18,
        ),
        "h2": ParagraphStyle(
            "h2", fontName="YaHeiBold", fontSize=15, leading=22,
            textColor=colors.HexColor("#0F172A"), spaceBefore=16, spaceAfter=9,
            leftIndent=9, borderPadding=(0, 0, 0, 8),
        ),
        "h3": ParagraphStyle(
            "h3", fontName="YaHeiBold", fontSize=11.5, leading=17,
            textColor=colors.HexColor("#27272A"), spaceBefore=12, spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body", fontName="YaHei", fontSize=10, leading=17,
            textColor=TEXT, spaceAfter=7,
        ),
        "li": ParagraphStyle(
            "li", fontName="YaHei", fontSize=10, leading=17,
            textColor=TEXT, spaceAfter=4, leftIndent=14, bulletIndent=4,
        ),
        "code": ParagraphStyle(
            "code", fontName="Courier", fontSize=8.5, leading=13,
            textColor=colors.HexColor("#E4E4E7"), backColor=colors.HexColor("#18181B"),
            borderPadding=(7, 9, 7, 9), spaceAfter=9, leftIndent=0,
        ),
        "caption": ParagraphStyle(
            "caption", fontName="YaHei", fontSize=8.5, leading=13,
            textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10,
        ),
        "note": ParagraphStyle(
            "note", fontName="YaHei", fontSize=9.5, leading=16,
            textColor=colors.HexColor("#155E75"), backColor=NOTE_BG,
            borderPadding=(8, 10, 8, 10), spaceAfter=9,
        ),
        "warn": ParagraphStyle(
            "warn", fontName="YaHei", fontSize=9.5, leading=16,
            textColor=colors.HexColor("#78350F"), backColor=WARN_BG,
            borderPadding=(8, 10, 8, 10), spaceAfter=9,
        ),
        "danger": ParagraphStyle(
            "danger", fontName="YaHei", fontSize=9.5, leading=16,
            textColor=colors.HexColor("#7F1D1D"), backColor=DANGER_BG,
            borderPadding=(8, 10, 8, 10), spaceAfter=9,
        ),
        "toc": ParagraphStyle(
            "toc", fontName="YaHei", fontSize=10, leading=18, textColor=TEXT,
        ),
    }


ST = make_styles()


def P(text, style="body"):
    return Paragraph(text, ST[style])


def H2(text):
    """二级标题带左侧色条。"""
    t = Table([[Paragraph(text, ST["h2"])]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("LINEBEFORE", (0, 0), (0, -1), 3.5, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [Spacer(1, 8), t, Spacer(1, 8)]


def H3(text):
    return P(text, "h3")


def BULLETS(items):
    return [Paragraph(f"• {x}", ST["li"]) for x in items]


def CODE(text):
    """等宽代码块。每行单独成段，避免长行溢出。"""
    lines = text.strip("\n").split("\n")
    body = "<br/>".join(
        line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace(" ", "&nbsp;")
        for line in lines
    )
    return Paragraph(body, ST["code"])


def IMG(name, caption, width_mm=170):
    """插入截图。优先从 shots/ 找，其次 .verify/。"""
    for base in (SHOTS, VERIFY):
        p = base / name
        if p.exists():
            from PIL import Image as PILImage

            with PILImage.open(p) as im:
                w, h = im.size
            disp_w = width_mm * mm
            disp_h = disp_w * h / w
            # 单页高度限制
            max_h = 150 * mm
            if disp_h > max_h:
                disp_h = max_h
                disp_w = disp_h * w / h
            img = Image(str(p), width=disp_w, height=disp_h)
            return KeepTogether([Spacer(1, 4), img, P(caption, "caption")])
    return P(f"[缺图：{name}]", "caption")


def TABLE(rows, widths=None, header=True):
    """表格。第一行当表头。"""
    data = []
    for i, row in enumerate(rows):
        style = "h3" if (header and i == 0) else "body"
        data.append([Paragraph(str(c), ParagraphStyle(
            f"c{i}", parent=ST[style], fontSize=9, leading=14, spaceAfter=0,
        )) for c in row])
    if widths is None:
        n = len(rows[0])
        widths = [170 * mm / n] * n
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BG_SOFT if header else colors.white),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.HexColor("#D4D4D8")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return KeepTogether([t, Spacer(1, 9)])


def STEPS(items):
    """编号步骤，用彩色序号。"""
    out = []
    for i, text in enumerate(items, 1):
        out.append(Paragraph(
            f'<font color="#0891B2"><b>{i}.</b></font>　{text}',
            ParagraphStyle("step", parent=ST["body"], leftIndent=16, spaceAfter=7),
        ))
    return out


class Doc(BaseDocTemplate):
    """带页眉页脚的模板。"""

    def __init__(self, path, title, **kw):
        self.doc_title = title
        BaseDocTemplate.__init__(
            self, str(path), pagesize=A4,
            leftMargin=20 * mm, rightMargin=20 * mm,
            topMargin=18 * mm, bottomMargin=18 * mm,
            title=title, author="漫客工作台", **kw,
        )
        frame = Frame(
            self.leftMargin, self.bottomMargin,
            self.width, self.height, id="main",
        )
        self.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=self._decorate)])

    def _decorate(self, canvas, doc):
        canvas.saveState()
        w, h = A4
        # 页眉：细线 + 标题
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, h - 13 * mm, w - 20 * mm, h - 13 * mm)
        canvas.setFont("YaHei", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, h - 11 * mm, self.doc_title)
        # 页脚：页码
        canvas.drawCentredString(w / 2, 11 * mm, f"{doc.page}")
        canvas.restoreState()


# ══════════════════════════════════════════════════════════════
# 教程一：部署安装
# ══════════════════════════════════════════════════════════════

def build_deploy(path: Path):
    story = []
    a = story.append

    a(P("漫客工作台 · 部署安装教程", "title"))
    a(P("从零把工作台装到一台新机器上 · Windows 版", "subtitle"))

    a(TABLE([
        ["本教程包含", ""],
        ["1", "开始之前的准备（硬件与磁盘要求）"],
        ["2", "第一步：安装控制台"],
        ["3", "第二步：下载部署包"],
        ["4", "第三步：用控制台部署"],
        ["5", "第四步：启动与验证"],
        ["6", "常见问题处理"],
        ["7", "卸载"],
    ], widths=[16, 154]))
    a(Spacer(1, 6))

    story.extend(H2("1. 开始之前的准备"))

    story.extend([H3("硬件要求"), TABLE([
        ["项目", "要求"],
        ["操作系统", "Windows 10 / 11，64 位"],
        ["显卡", "NVIDIA，<b>20 GB 显存起步</b>（720P 视频生成）"],
        ["内存", "32 GB 建议"],
        ["磁盘", "<b>至少 430 GB 空闲</b>（部署包 210 GB + 解压后 211 GB）"],
    ], widths=[40, 130])])

    a(P("<b>显卡是硬门槛。</b>包里带的是 CUDA 版 PyTorch，AMD 显卡和 Intel 核显跑不了这套模型。"
        "驱动也要较新 —— 打包时用的是 CUDA 13.0，驱动太旧会报错，更新到最新即可。", "danger"))

    story.extend([H3("需要准备的东西"), TABLE([
        ["内容", "大小", "来源"],
        ["控制台安装程序", "25.6 MB", "漫客工作台控制台-Setup.exe"],
        ["部署包", "211.1 GB", "夸克网盘，7 个分卷"],
    ], widths=[48, 30, 92])])

    a(P("控制台只管「装什么、装到哪」，本身不含模型。真正的 ComfyUI、模型、节点包都在部署包里。"
        "两者配合使用：<b>先装控制台 → 用控制台部署大包</b>。", "note"))

    a(PageBreak())
    story.extend(H2("2. 第一步：安装控制台"))

    a(P("双击 <font color='#BE123C'>漫客工作台控制台-Setup.exe</font>，会出现安装向导。"))
    a(IMG("setup-wizard.png", "图 2-1　安装向导：选择安装位置", width_mm=140))

    story.extend(STEPS([
        "<b>选安装位置。</b>左边下拉框列出所有固定硬盘并显示可用空间；选一块盘，"
        "右边路径自动变成 <font color='#BE123C'>&lt;盘符&gt;\\漫客工作台</font>。也可以点「浏览…」自己挑目录。",
        "<b>点「安装」。</b>约 1-2 分钟，装 167 个文件、约 100 MB。",
        "<b>完成页勾选「立即打开控制台」，点「完成」。</b>",
    ]))

    a(P("不要装到 <font color='#BE123C'>C:\\Program Files</font>。那个目录需要管理员权限，"
        "写文件时会失败。向导会提前拦截并说明原因，但最好一开始就用默认位置"
        "（<font color='#BE123C'>%LOCALAPPDATA%\\Programs\\漫客工作台</font>）。", "warn"))

    story.extend([H3("装完之后目录里有什么"),
                  CODE("""%LOCALAPPDATA%\\Programs\\<install-dir>\\
    launcher\\      console UI, launcher, uninstaller
    scripts\\       deploy + environment check
    node\\          portable Node 24 + 7-Zip
    docs\\          dependency manifest
    data\\          config
    deploy\\        drop volume files here"""),
                  P("同时会创建桌面和开始菜单快捷方式，并在「设置 → 应用」里注册卸载入口。")])

    a(PageBreak())
    story.extend(H2("3. 第二步：下载部署包"))

    a(P("部署包在夸克网盘上，共 <b>7 个分卷，211.1 GB</b>。"))
    a(TABLE([
        ["文件", "大小", "说明"],
        ["manke-bundle.7z.001", "34.00 GB", "开头"],
        ["manke-bundle.7z.002", "34.00 GB", "中间，大小相同"],
        ["manke-bundle.7z.003", "34.00 GB", "中间，大小相同"],
        ["manke-bundle.7z.004", "34.00 GB", "中间，大小相同"],
        ["manke-bundle.7z.005", "34.00 GB", "中间，大小相同"],
        ["manke-bundle.7z.006", "34.00 GB", "中间，大小相同"],
        ["manke-bundle.7z.007", "6.70 GB", "最后一个偏小"],
        ["README-必读.md", "—", "说明文档"],
        ["校验清单.md", "—", "每个分卷的 SHA256"],
    ], widths=[62, 32, 76]))

    a(P("<b>7 个分卷必须全部下载，一个都不能少。</b>它们是一个档案切成的 7 段，少一个就解不开。"
        "别试图只下几个先试。", "warn"))

    story.extend([H3("下载到哪"),
                  P("把 7 个分卷 <b>放在同一个目录</b>，比如："),
                  CODE("""D:\\manke-deploy\\
    manke-bundle.7z.001
    manke-bundle.7z.002
    ...
    manke-bundle.7z.007"""),
                  P("这个目录就是后面控制台里要填的「部署包目录」。"),
                  H3("校验完整性（推荐）"),
                  P("下完建议核对一遍，避免解压到一半才发现某个包没下全："),
                  P("在放分卷的目录里执行："),
                  CODE("""Get-ChildItem *.7z.* | ForEach-Object {
  "{0}  {1}" -f $_.Name, (Get-FileHash $_.Name -Algorithm SHA256).Hash
}"""),
                  P("把输出和 校验清单.md 里的一行行对比，全部一致就没问题。")])

    a(PageBreak())
    story.extend(H2("4. 第三步：用控制台部署"))

    a(P("打开桌面上的「漫客工作台 控制台」。界面分成三块：服务状态、操作按钮、环境自检。"))
    a(IMG("deploy-wizard.png", "图 4-1　控制台主界面：服务状态、按钮区、环境自检、运行日志"))

    story.extend([H3("第 1 步：检查部署包"),
                  P("点 <b>「检查部署包」</b>。如果分卷不在默认的 deploy\\ 目录里，会弹出文件夹选择框，"
                    "选你放分卷的那个目录。检查通过后日志显示："),
                  CODE("""volumes: 7  |  211.1 GB  |  complete
extract to: D:\\
[done] target drive has 425 GB free
ready to deploy""")])

    story.extend([H3("第 2 步：点「一键部署」，选硬盘"),
                  P("这时候会弹出选盘窗口："),
                  IMG("drive-picker.png", "图 4-2　选盘窗口：每个盘标出可用空间和差多少 GB", width_mm=120),
                  P("窗口里每一行是一个固定硬盘，格式是："),
                  CODE("""[ok]   D:\\   425 / 476 GB free
[--]   C:\\    52 / 207 GB free   (short by 158 GB)""")
                  ])
    story.extend(BULLETS([
        "<b>实心圆点</b> = 空间够，可以选（绿色）",
        "<b>空心圆点</b> = 空间不够，标出差多少 GB（灰色）",
        "默认自动选中第一个够用的盘",
    ]))
    a(P("解压需要约 211 GB。如果所有盘都不够，窗口会全部显示灰点 —— 这时候得先清理磁盘，"
        "或者把分卷挪到别的盘再重新检查。", "note"))

    story.extend([H3("第 3 步：等待解压"),
                  P("确认后开始解压，进度实时打到日志区。整个过程 <b>约 20-40 分钟</b>，取决于磁盘速度。"),
                  P("解压期间<b>不要关闭窗口</b>，也不要动目标盘上的文件。中断了得从头再来。", "danger"),
                  P("解压完成后日志显示："),
                  CODE("""[done] ComfyUI    D:\\manke\\ComfyUI
[done] workbench  D:\\manke\\workbench"""),
                  H3("解压出来是什么"),
                  CODE("""D:\\manke\\
    ComfyUI\\              ready to run
        python_embeded\\   portable Python 3.13 + PyTorch
        models\\           26 models, 203.9 GB
        custom_nodes\\     13 node packs
        main.py
    workbench\\            workbench source""")])

    a(PageBreak())
    story.extend(H2("5. 第四步：启动与验证"))

    story.extend([H3("指定 ComfyUI 位置"),
                  P("回到控制台，点 <b>「ComfyUI 位置」</b>。如果刚解压完，选 "
                    "<font color='#BE123C'>D:\\manke\\ComfyUI</font>。"),
                  P("如果机器上本来就装有 ComfyUI，选那个已有目录也行 —— 控制台会写进 "
                    "<font color='#BE123C'>data\\comfyui.config.json</font>，启动时用这个位置。"),
                  H3("运行环境自检"),
                  P("点 <b>「检查」</b>，应该看到 12 项全部通过："),
                  P("12 项检查应该全部通过。下面是实际输出（中文版显示为中文，这里按结构示意）："),
                  CODE("""[ok] build          .output/server/index.mjs
[ok] deps           node_modules
[ok] config         data/comfyui.config.json
[ok] comfy-location D:\\manke\\ComfyUI
[ok] pythonPath     ...\\python_embeded\\python.exe
[ok] comfyui        http://127.0.0.1:8188  |  20 GB VRAM
[ok] templates      22
[ok] nodes          13 / 13
[ok] models         30 / 30  |  228.6 GB
pass 12  warn 0  fail 0"""),
                  H3("启动服务"),
                  P("点 <b>「全部启动」</b>，控制台会依次拉起 ComfyUI 和工作台：")])

    story.extend(BULLETS([
        "ComfyUI 启动约需 30-60 秒（要扫描 26 个模型）",
        "工作台启动约需 30 秒",
    ]))

    story.extend([P("两个都显示「运行中」后，点 <b>「打开工作台」</b>，浏览器会打开 "
                    "<font color='#BE123C'>http://127.0.0.1:3020</font>。"),
                  H3("跑第一个生成任务")])

    story.extend(STEPS([
        "打开工作台，点顶部「创作」",
        "选一个模型，比如「小枫-qwen-image-2-1-文生图」",
        "输入提示词，比如「雨夜的旧城区，路灯昏黄」",
        "点生成",
    ]))

    a(P("图片约 1-2 分钟出结果。视频更慢，720P 单段约 3-4 分钟，建议先从图片试起。", "body"))
    a(P("看到图片出来，说明整条链路 —— 控制台 → 工作台 → ComfyUI → 模型 —— 全部打通了。", "note"))

    a(PageBreak())
    story.extend(H2("6. 常见问题"))

    a(TABLE([
        ["现象", "原因与处理"],
        ["解压报「数据错误」", "某个分卷没下全。对照 校验清单.md 逐包核对 SHA256，重下损坏的那个。"],
        ["提示「找不到下一卷」", "7 个分卷没放在同一个目录。"],
        ["ComfyUI 起不来，报 ImportError: cannot import name 'models'",
         "解压不完整（torchvision\\models 缺失）。旧版部署包有这个问题，当前的 7.0 GB 版本已修复，重新解压。"],
        ["ComfyUI 起来了但节点是灰的",
         "custom_nodes 没解出来。检查 D:\\manke\\ComfyUI\\custom_nodes 下是否有 13 个目录。"],
        ["生成时报 CUDA out of memory",
         "显存不够。在「生成参数台」里把分辨率降到 720P 或 480P，显存档位选「自动」。"],
        ["控制台显示服务运行中，但自检报「无响应」",
         "ComfyUI 还在启动。等 30-60 秒再点「检查」，自检会自动等端口就绪。"],
        ["一键部署点了没反应",
         "先点「检查部署包」看分卷状态。分卷不全时会先让你选目录，不会静默失败。"],
        ["驱动太旧报错", "包里是 CUDA 13.0 版 PyTorch，把 NVIDIA 驱动更新到最新。"],
    ], widths=[62, 108]))

    story.extend(H2("7. 卸载"))
    story.extend([H3("卸控制台"), P("三种方式，效果一样：")])
    story.extend(STEPS([
        "<b>设置 → 应用 → 「漫客工作台 · 服务控制台」→ 卸载</b>",
        "双击安装目录里的 卸载.vbs",
        "命令行运行 uninstall.cmd",
    ]))
    a(P("会删除：控制台程序、Node、7-Zip、快捷方式、注册表项。"))

    story.extend([H3("卸载不会删什么"), TABLE([
        ["内容", "为什么保留"],
        ["deploy\\ 里的分卷", "那是 200 GB 数据，误删很痛"],
        ["ComfyUI 安装目录", "模型和节点在里面"],
        ["工作台项目目录", ".output、node_modules"],
        ["计划任务 BD-ComfyUI / BD-Workbench", "那是运行环境，不是控制台的一部分"],
    ], widths=[70, 100])])

    story.extend([H3("彻底清理"),
                  P("要连部署的数据一起删："),
                  CODE("""Remove-Item "$env:LOCALAPPDATA\\Programs\\<install-dir>" -Recurse -Force
Remove-Item "D:\\manke" -Recurse -Force
Remove-Item "D:\\manke-deploy" -Recurse -Force""")])

    story.extend(H2("附：磁盘占用参考"))
    a(TABLE([
        ["阶段", "占用"],
        ["控制台", "约 100 MB"],
        ["7 个分卷", "211.1 GB"],
        ["解压后", "211 GB"],
        ["峰值合计", "<b>约 422 GB</b>"],
    ], widths=[85, 85]))
    a(P("解压完成并验证通过后，可以删掉那 7 个分卷，省回 211.1 GB。"
        "建议保留至少一周，确认系统稳定再删。", "note"))

    doc = Doc(path, "漫客工作台 · 部署安装教程")
    doc.build(story)


# ══════════════════════════════════════════════════════════════
# 教程二：使用教程
# ══════════════════════════════════════════════════════════════

def build_usage(path: Path):
    story = []
    a = story.append

    a(P("漫客工作台 · 使用教程", "title"))
    a(P("从第一张图到完整短片 · 详细操作指南", "subtitle"))

    a(TABLE([
        ["本教程包含", ""],
        ["1", "界面总览：四个主要区域"],
        ["2", "创作台：文生图与图生图"],
        ["3", "画布：可视化工作流编排"],
        ["4", "AI 短剧模式：分镜到成片"],
        ["5", "项目管理与素材库"],
        ["6", "生成参数详解"],
        ["7", "常见工作流与提示词技巧"],
    ], widths=[16, 154]))
    a(Spacer(1, 6))

    story.extend(H2("1. 界面总览"))

    a(P("打开 <font color='#BE123C'>http://127.0.0.1:3020</font>，首页是这样："))
    a(IMG("01-home.png", "图 1-1　首页：中间是提示词输入框，下面是本机真实生成的作品轮播"))

    story.extend([H3("顶部导航四个入口"), TABLE([
        ["入口", "作用", "适合"],
        ["首页", "直接输入提示词生成，最快出结果", "试想法、随手创作"],
        ["创作", "创作台：完整参数控制，单张精修", "正式出图、调参"],
        ["项目", "所有生成记录，按项目组织", "管理作品、批量导出"],
        ["素材", "本机生成过的一切图片和视频", "找历史素材、复用"],
    ], widths=[24, 90, 56])])

    story.extend([H3("右上角三个控制"), TABLE([
        ["控件", "作用"],
        ["ZH / EN / 日本語", "切换界面语言，三种语言完整翻译"],
        ["太阳 / 月亮图标", "浅色 / 深色主题切换"],
        ["方框图标", "编辑模式：显示工作流节点，适合调试"],
    ], widths=[46, 124])])

    story.extend(H2("2. 创作台：文生图与图生图"))

    a(P("点顶部「创作」，进入创作台。这是日常用得最多的界面。"))
    a(IMG("02-studio.png", "图 2-1　新建项目：三个入口分别是创作台、基本画布、AI 短剧模式"))

    story.extend([H3("三个入口怎么选"), TABLE([
        ["入口", "这是什么", "什么时候用"],
        ["创作台", "单张图片 / 单段视频，参数面板齐全", "做单张图、试提示词"],
        ["基本画布", "节点式可视化编排，自由连线条", "自定义流程、调工作流"],
        ["AI 短剧模式", "分镜列表 + 角色设定 + 配音", "做多镜头短片"],
    ], widths=[30, 70, 70])])

    a(P("第一次用建议从 <b>创作台</b> 开始 —— 它把常用参数都摆出来了，不用理解节点。"))

    story.extend([H3("一次完整的文生图"), P("在创作台里：")])

    story.extend(STEPS([
        "<b>选模型。</b>顶部下拉框选「小枫-qwen-image-2-1-文生图」。这是出图质量最好的一个。",
        "<b>写提示词。</b>越具体越好。比如「雨夜的旧城区街道，积水映着霓虹招牌，电影感浅景深」。",
        "<b>设分辨率。</b>默认 1328×1328。显存紧张就降到 1024 或 768。",
        "<b>设步数和 CFG。</b>步数 20-30 够用；CFG 4.0-5.0 之间，太高会过饱和。",
        "<b>点生成。</b>进度条在右下角，会显示当前跑到第几步。",
        "<b>看结果。</b>不满意的可以调提示词重跑，或换种子。",
    ]))

    a(P("单张图约 1-2 分钟（20 GB 显存）。第一次跑会慢一些，要加载模型进显存。", "note"))

    story.extend([H3("图生图"), P("把参考图拖进左侧的「输入图」区域，然后：")])
    story.extend(BULLETS([
        "<b>重绘幅度（denoise）</b> 是关键参数：0.3 左右微调，0.6 明显改变，0.85 以上基本重画",
        "提示词要描述<b>你想要的最终画面</b>，不是描述参考图",
        "想保留构图就把重绘幅度调低，想换风格就调高",
    ]))

    a(PageBreak())
    story.extend(H2("3. 画布：可视化工作流编排"))

    a(P("画布是节点式的 —— 每个节点做一件事，用线连起来组成流水线。"))
    a(IMG("03-canvas.png", "图 3-1　画布：可以打开已有工作流，也可以从空白开始搭"))

    story.extend([H3("什么时候需要用画布"), TABLE([
        ["场景", "为什么画布更合适"],
        ["想改工作流结构", "创作台只能用预设流程，画布能随便加减节点"],
        ["要复现别人的流程", "直接导入工作流 JSON 就能跑"],
        ["调试生成问题", "能看到每一步的中间结果"],
        ["做复杂链路", "文生图 → 放大 → 图生视频，画布能串起来"],
    ], widths=[50, 120])])

    story.extend([H3("基本操作"), TABLE([
        ["操作", "方法"],
        ["添加节点", "右键空白处 → 选择节点类型"],
        ["连接节点", "从节点右侧输出点拖到另一节点左侧输入点"],
        ["移动画布", "按住空格拖拽，或拖动空白处"],
        ["缩放", "Ctrl + 滚轮"],
        ["删除节点", "选中后按 Delete"],
        ["运行", "点右上角「运行」，或按 Ctrl + Enter"],
    ], widths=[36, 134])])

    a(P("工作台内置了 22 个工作流模板，覆盖文生图、图生视频、语音合成、视频放大、换脸、深度估计。"
        "在画布列表里能直接打开。", "note"))

    a(PageBreak())
    story.extend(H2("4. AI 短剧模式：分镜到成片"))

    a(P("这是做多镜头短片的地方。和创作台的区别：创作台出单张，短剧模式管理整个叙事。"))

    story.extend([H3("四个步骤"), TABLE([
        ["阶段", "做什么", "产出"],
        ["1. 剧本", "写故事大纲，AI 拆成分镜", "分镜列表（每个镜头一句描述）"],
        ["2. 角色", "定义主角长相，给参考图或描述", "角色一致性锚点"],
        ["3. 出图", "逐镜生成或批量生成", "每个镜头的画面"],
        ["4. 配音 + 成片", "生成旁白/对白，拼接镜头", "带字幕的完整视频"],
    ], widths=[32, 68, 70])])

    story.extend([H3("让镜头之间连贯的三个要点")])
    story.extend(BULLETS([
        "<b>角色锚点</b>：同一个角色在所有镜头里要用同一张参考图，否则长相会变",
        "<b>场景词汇统一</b>：比如「雨夜」「旧城区」这类词在每个镜头的提示词里都保留",
        "<b>镜头语言</b>：相邻镜头避免完全相同机位，加「特写」「远景」「俯拍」来区分",
    ]))

    a(P("生成视频比图片慢得多。720P 单段约 3-4 分钟，1080P 约 8-9 分钟。"
        "建议先用 720P 把故事跑通，满意了再整体升到 1080P。", "warn"))

    a(PageBreak())
    story.extend(H2("5. 项目管理与素材库"))

    story.extend([H3("项目"), P("所有生成记录都归到项目里。项目列表能看到每个项目的封面、生成数量、更新时间。")])
    a(IMG("04-projects.png", "图 5-1　项目列表：每个项目一张卡片，显示封面和作品数"))

    story.extend(BULLETS([
        "点卡片进入项目，能看到这个项目下的所有生成结果",
        "删除项目会<b>级联删除</b>它产出的所有素材（进回收站，可恢复）",
        "项目按时间排序，最近动的在最前",
    ]))

    story.extend([H3("素材库"), P("本机生成过的所有图片和视频都在这里，跨项目汇总。")])
    a(IMG("05-assets.png", "图 5-2　素材库：所有生成结果，可以按类型筛选"))

    story.extend(BULLETS([
        "按类型筛选：全部 / 图片 / 视频",
        "点素材看大图，能直接下载或复用为下一张的参考图",
        "删掉的素材进回收站，不会立刻消失",
    ]))

    story.extend([H3("目录在哪"), CODE("""<workbench>\\
    data\\
        generated\\     images and videos
        workflows\\     22 workflow templates
        trash\\         recycle bin
        logs\\          runtime logs
    .output\\           build output""")])

    a(PageBreak())
    story.extend(H2("6. 生成参数详解"))

    a(TABLE([
        ["参数", "作用", "建议值"],
        ["分辨率", "输出尺寸。越大越慢，显存占用越高", "1328×1328（默认）<br/>显存紧张降到 1024"],
        ["步数 Steps", "去噪迭代次数。少了细节不足，多了收益递减", "20-30"],
        ["CFG", "提示词遵从强度。太高会过饱和、失真", "4.0-5.0"],
        ["种子 Seed", "-1 每次随机；固定值可以复现同一张图", "-1 或喜欢的值"],
        ["采样器", "去噪算法。不同采样器风格略有区别", "euler / dpmpp_2m"],
        ["重绘幅度", "仅图生图。控制偏离参考图的程度", "0.3 微调 / 0.6 改动"],
    ], widths=[28, 82, 60]))

    a(P("显存档位在「生成参数台」里选。20 GB 显存建议「自动」，让系统自己调度；"
        "12 GB 以下显存选「低」并降分辨率。", "note"))

    story.extend([H3("视频专属参数")])
    a(TABLE([
        ["参数", "作用", "建议值"],
        ["帧数", "生成多少帧。25 帧约 1 秒", "49 / 97 帧"],
        ["FPS", "播放帧率", "25"],
        ["视频分辨率", "720P 够日常用，1080P 要 8-9 分钟/段", "720P 起步"],
    ], widths=[28, 82, 60]))

    a(PageBreak())
    story.extend(H2("7. 常见工作流与提示词技巧"))

    story.extend([H3("22 个工作流模板覆盖什么"), TABLE([
        ["类别", "模板", "用途"],
        ["文生图", "Qwen-Image 2.1 基础 / 高清", "最常用，出图质量最高"],
        ["图生图", "参考图重绘 / 风格迁移", "在已有图基础上改"],
        ["文生视频", "MiniMax H3 基础 / 长视频", "从文字直接出视频"],
        ["图生视频", "单图运镜 / 首尾帧", "让静态图动起来"],
        ["语音", "Qwen3-TTS 旁白 / 对白", "生成配音"],
        ["后处理", "SeedVR2 视频放大", "720P 升 1080P"],
        ["工具", "ReActor 换脸 / DepthAnything 深度", "特定加工"],
    ], widths=[28, 72, 70])])

    story.extend([H3("提示词怎么写")])

    story.extend(STEPS([
        "<b>主体 + 环境 + 光线 + 质感</b>，四段式最稳。<br/>"
        "「一个穿风衣的女人，雨夜的老街，暖黄路灯从侧面照，电影胶片质感」",
        "<b>具体比抽象好。</b>「破旧的木门」比「有年代感的东西」好得多。",
        "<b>避免否定句。</b>模型更懂「玻璃很干净」而不是「不要脏」。",
        "<b>风格词放最后。</b>「…，摄影作品，浅景深，35mm」",
        "<b>人物保持一致</b>用同一张参考图 + 同样的外貌描述。",
    ]))

    story.extend([H3("常用风格词速查"), TABLE([
        ["想要的效果", "可以加的词"],
        ["电影感", "cinematic lighting, shallow depth of field, 35mm film"],
        ["插画", "digital illustration, clean lineart, flat shading"],
        ["写实摄影", "photorealistic, natural lighting, high detail"],
        ["国风", "traditional Chinese painting, ink wash, 水墨"],
        ["赛博朋克", "cyberpunk, neon lights, rain, night city"],
        ["动漫", "anime style, cel shading, vibrant colors"],
    ], widths=[40, 130])])

    story.extend([H3("三个常见问题")])
    a(TABLE([
        ["现象", "原因", "怎么改"],
        ["人物每张都长得不一样", "没有固定角色锚点", "用同一张参考图 + 固定种子"],
        ["画面糊、细节少", "步数太低或分辨率太小", "步数提到 25-30，分辨率提到 1328"],
        ["颜色过饱和 / 发灰", "CFG 太高或太低", "CFG 调到 4.0-5.0 之间"],
        ["视频动作卡顿", "帧数太少或 FPS 不匹配", "帧数提到 97，FPS 设 25"],
    ], widths=[46, 54, 70]))

    story.extend(H2("附：快捷键"))
    a(TABLE([
        ["操作", "快捷键"],
        ["运行工作流", "Ctrl + Enter"],
        ["缩放画布", "Ctrl + 滚轮"],
        ["删除选中节点", "Delete"],
        ["深色 / 浅色切换", "右上角太阳 / 月亮图标"],
    ], widths=[85, 85]))

    doc = Doc(path, "漫客工作台 · 使用教程")
    doc.build(story)


def main():
    # Windows 控制台默认 GBK，直接 print 中文/勾号会抛 UnicodeEncodeError。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    DOCS.mkdir(parents=True, exist_ok=True)

    deploy_pdf = DOCS / "漫客工作台-部署安装教程.pdf"
    usage_pdf = DOCS / "漫客工作台-使用教程.pdf"

    print("  building deploy guide...")
    build_deploy(deploy_pdf)
    if deploy_pdf.exists():
        print("[ok] %s  %.0f KB" % (deploy_pdf.name, deploy_pdf.stat().st_size / 1024))
    else:
        print("[fail]")
        return 1

    print("  building usage guide...")
    build_usage(usage_pdf)
    if usage_pdf.exists():
        print("[ok] %s  %.0f KB" % (usage_pdf.name, usage_pdf.stat().st_size / 1024))
    else:
        print("  × 失败")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
