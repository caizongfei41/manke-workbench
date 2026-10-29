# 生成《漫客工作台 · 完整图文教程》
#
#   E:\ComfyUI\python_embeded\python.exe scripts\make-tutorial-pdf.py
#
# 一份覆盖全流程的图文手册：下载 → 安装 → 部署 → 启动 → 每个功能 → 排错。
#
# 为什么单独一个脚本而不是改 make-docs-pdf.py：
#   原来那个产出「部署教程」和「使用教程」两份，读者要来回翻。
#   这份合成一册，按真实使用顺序走一遍。

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
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
SHOTS = ROOT / ".verify" / "shots" / "tutorial"
LEGACY_SHOTS = ROOT / ".verify" / "shots"

ACCENT = colors.HexColor("#0891B2")
TEXT = colors.HexColor("#18181B")
MUTED = colors.HexColor("#71717A")
BORDER = colors.HexColor("#E4E4E7")
BG_SOFT = colors.HexColor("#FAFAFA")
WARN_BG = colors.HexColor("#FEF3C7")
DANGER_BG = colors.HexColor("#FEE2E2")
NOTE_BG = colors.HexColor("#ECFEFF")

FONT_DIR = Path(r"C:\Windows\Fonts")
pdfmetrics.registerFont(TTFont("YaHei", str(FONT_DIR / "msyh.ttc")))
pdfmetrics.registerFont(TTFont("YaHeiBold", str(FONT_DIR / "msyhbd.ttc")))
pdfmetrics.registerFont(TTFont("SimHei", str(FONT_DIR / "simhei.ttf")))
registerFontFamily(
    "YaHei", normal="YaHei", bold="YaHeiBold", italic="YaHei", boldItalic="YaHeiBold"
)


def make_styles():
    return {
        "h2": ParagraphStyle(
            "h2", fontName="YaHeiBold", fontSize=16, leading=24,
            textColor=colors.HexColor("#0F172A"), spaceBefore=14, spaceAfter=10,
        ),
        "h3": ParagraphStyle(
            "h3", fontName="YaHeiBold", fontSize=11.5, leading=18,
            textColor=colors.HexColor("#27272A"), spaceBefore=12, spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body", fontName="YaHei", fontSize=10, leading=17,
            textColor=TEXT, spaceAfter=7,
        ),
        "code": ParagraphStyle(
            "code", fontName="Courier", fontSize=8.5, leading=13,
            textColor=colors.HexColor("#E4E4E7"),
            backColor=colors.HexColor("#18181B"),
            borderPadding=(7, 9, 7, 9), spaceAfter=9,
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
    }


ST = make_styles()


def P(text, style="body"):
    return Paragraph(text, ST[style])


def H2(text):
    return Paragraph(text, ST["h2"])


def H3(text):
    return Paragraph(text, ST["h3"])


def CODE(text):
    esc = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(esc.replace("\n", "<br/>").replace(" ", "&nbsp;"), ST["code"])


def NOTE(text):
    return P(text, "note")


def WARN(text):
    return P(text, "warn")


def TIP(text):
    return P(text, "note")


def IMG(name, caption, width_mm=165):
    """插入截图。先找 tutorial 目录，再找旧目录。"""
    for base in (SHOTS, LEGACY_SHOTS):
        p = base / name
        if not p.exists():
            continue
        from PIL import Image as PILImage

        with PILImage.open(p) as im:
            w, h = im.size
        disp_w = width_mm * mm
        disp_h = disp_w * h / w
        max_h = 145 * mm
        if disp_h > max_h:
            disp_h = max_h
            disp_w = disp_h * w / h
        img = Image(str(p), width=disp_w, height=disp_h)
        return KeepTogether([Spacer(1, 4), img, P(caption, "caption")])
    return P(f"[缺图：{name}]", "caption")


def TABLE(rows, widths=None, header=True):
    data = []
    for i, row in enumerate(rows):
        style = "h3" if (header and i == 0) else "body"
        data.append([
            Paragraph(str(c), ParagraphStyle(
                f"c{i}", parent=ST[style], fontSize=9, leading=14, spaceAfter=0,
            ))
            for c in row
        ])
    if widths is None:
        n = len(rows[0])
        widths = [170 / n] * n
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
    out = []
    for i, text in enumerate(items, 1):
        out.append(Paragraph(
            f'<font color="#0891B2"><b>{i}.</b></font>　{text}',
            ParagraphStyle("step", parent=ST["body"], leftIndent=16, spaceAfter=7),
        ))
    return out


class Doc(BaseDocTemplate):
    def __init__(self, path, title, **kw):
        self.doc_title = title
        super().__init__(
            str(path), pagesize=A4,
            leftMargin=20 * mm, rightMargin=20 * mm,
            topMargin=18 * mm, bottomMargin=18 * mm,
            title=title, author="漫客工作台", **kw,
        )
        frame = Frame(
            self.leftMargin, self.bottomMargin,
            self.width, self.height, id="body",
        )
        self.addPageTemplates([
            PageTemplate(id="main", frames=[frame], onPage=self._decorate),
        ])

    def _decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("YaHei", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 11 * mm, self.doc_title)
        canvas.drawRightString(
            A4[0] - 20 * mm, 11 * mm, f"第 {canvas.getPageNumber()} 页"
        )
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
        canvas.restoreState()


# ─────────────────────────── 正文各章 ───────────────────────────


def cover():
    cs = ParagraphStyle("cs", fontName="YaHeiBold", fontSize=11, alignment=TA_CENTER)
    ct = ParagraphStyle("ct", fontName="SimHei", fontSize=36, alignment=TA_CENTER, leading=46)
    cd = ParagraphStyle("cd", fontName="YaHeiBold", fontSize=19, alignment=TA_CENTER, leading=28)
    csub = ParagraphStyle("csub", fontName="YaHei", fontSize=12, alignment=TA_CENTER,
                          textColor=MUTED)
    cf = ParagraphStyle("cf", fontName="YaHei", fontSize=9, alignment=TA_CENTER,
                        textColor=colors.HexColor("#A1A1AA"))
    return [
        Spacer(1, 40 * mm),
        Paragraph("MANKE WORKBENCH", cs),
        Spacer(1, 8 * mm),
        Paragraph("漫客工作台", ct),
        Spacer(1, 5 * mm),
        Paragraph("完整图文教程", cd),
        Spacer(1, 3 * mm),
        Paragraph("从下载到出片，一步一步", csub),
        Spacer(1, 16 * mm),
        IMG("01-home.png", "", 150),
        Spacer(1, 14 * mm),
        Paragraph("版本 1.0.0　·　Windows 10 / 11　·　需要 NVIDIA 显卡 20 GB 显存", cf),
        PageBreak(),
    ]


def part_intro():
    return [
        H2("一、认识漫客工作台"),
        P(
            "漫客工作台把 <b>ComfyUI 的全部能力</b>包进了一个网页界面。"
            "你不需要会连节点、不需要记参数名、不需要碰命令行 —— "
            "打开网页，写一句话，选个模型，点生成。"
        ),
        P(
            "ComfyUI 在本地后台跑着，外面套了一层像设计软件一样的界面："
            "创作台管生成，画布管排版，素材库管文件，项目管归档。"
        ),
        Spacer(1, 3),
        IMG("01-home.png", "图 1-1　首页：顶部四大入口，中间输入框，下方是本机生成过的画面", 165),
        H3("这台机器能做什么"),
        TABLE([
            ["功能", "说明", "典型耗时"],
            ["图片生成", "Qwen-Image 2.1、Flux.2、Seedream 等模型出图", "30 秒 ~ 2 分钟"],
            ["视频生成", "MiniMax H3 系列，支持导演模式、无限分段、人物参考图锁脸", "3 ~ 15 分钟"],
            ["音乐生成", "YuE2 歌曲创作与翻唱，写歌词出带演唱的完整歌曲", "2 ~ 4 分钟"],
            ["素材分析", "反推图片的提示词、拆解画面元素", "20 ~ 60 秒"],
            ["画布排版", "把生成的图拖进画布做分镜、拼图、导出", "即时"],
            ["短剧模式", "按镜头写剧本，批量生成连贯视频", "按镜头数"],
        ], [26, 108, 36]),
        H3("四种用法，按需要选"),
        *STEPS([
            "<b>随手出图</b>：首页输入框写描述，直接回车。适合试效果、找灵感。",
            "<b>精细控制</b>：进「创作台」，选模型、调参数、上传参考图。适合正经做图。",
            "<b>做片子</b>：用「短剧模式」，一句一句写镜头，最后拼成完整视频。",
            "<b>整理归档</b>：画布排版 + 素材库 + 项目，把零散的图变成一套作品。",
        ]),
        PageBreak(),
    ]


def part_download():
    return [
        H2("二、下载部署包"),
        P(
            "部署包是一个 <b>211 GB</b> 的压缩档案，里面塞好了：便携 Python、"
            "PyTorch、ComfyUI 本体、26 个常用模型、13 个自定义节点包、工作台源码。"
            "换句话说，<b>装完就能直接出片，不用再下载任何模型</b>。"
        ),
        TABLE([
            ["内容", "大小", "说明"],
            ["便携 Python + PyTorch", "6.4 GB", "Python 3.13 + torch 2.13 (CUDA 13.0)"],
            ["26 个模型", "203.9 GB", "图片、视频、音乐、语音全套"],
            ["13 个节点包", "250 MB", "MiniMax H3、YuE2、ReActor 等"],
            ["ComfyUI 本体", "70 MB", "版本 0.42.0"],
            ["工作台源码", "19 MB", "界面 + 服务端"],
            ["<b>合计</b>", "<b>211 GB</b>", "解压后约 212 GB"],
        ], [50, 34, 86]),
        H3("2.1　打开下载地址"),
        P("部署包放在夸克网盘。用浏览器打开链接，或复制口令在夸克 APP 里打开："),
        CODE(
            "链接：https://pan.quark.cn/s/8d1ed42563d4\n"
            "口令：~9d1f3bt6QP~:/"
        ),
        TIP(
            "网盘里是一个叫 <b>manke-big</b> 的文件夹，里面有 <b>8 个文件</b>："
            "7 个分卷（.001 到 .007）加一份《校验清单.md》。"
            "<b>全部都要下载，一个都不能少。</b>"
        ),
        H3("2.2　下载时注意三件事"),
        *STEPS([
            "<b>全部下载</b>：7 个分卷缺任何一个都解压不了。分卷是「一个档案切开」的，不是独立压缩包。",
            "<b>放在同一个文件夹</b>：下载完要待在同一个目录里，不要分开存。",
            "<b>不要改名</b>：<code>manke-bundle.7z.001</code> 这种名字是 7-Zip 识别分卷的依据。",
        ]),
        WARN(
            "如果下载中断，请重新下载<b>那一个分卷</b>。中断的文件大小会小于应有值，"
            "对着《校验清单.md》核对大小就能看出来。"
        ),
        H3("2.3　核对文件是否完整"),
        P("下载完全部 8 个文件后，先别急着解压，核对每个分卷的大小："),
        TABLE([
            ["文件", "正确大小"],
            ["manke-bundle.7z.001 ~ .006", "每个 34.00 GB"],
            ["manke-bundle.7z.007", "7.06 GB"],
            ["校验清单.md", "小文件"],
            ["<b>合计</b>", "<b>211.06 GB</b>"],
        ], [90, 44]),
        PageBreak(),
    ]


def part_install():
    return [
        H2("三、安装控制台"),
        P(
            "「控制台」是一个独立的小程序（25.7 MB），负责启动和关闭 ComfyUI 与工作台。"
            "它不占资源，装一次就够。"
        ),
        H3("3.1　运行安装程序"),
        P("把 <b>漫客工作台控制台-Setup.exe</b> 下载到本地，双击运行。会看到一个三页的向导："),
        *STEPS([
            "<b>欢迎页</b>：选择安装位置。默认装在用户目录，也可以点「浏览」换地方。",
            "<b>安装中</b>：自动解压文件、创建快捷方式、注册到「设置 → 应用」，约 20 秒。",
            "<b>完成页</b>：可以勾选「立即打开控制台」。",
        ]),
        TIP(
            "如果 Windows 弹出「已保护你的电脑」（SmartScreen），说明这个 exe 没有代码签名证书。"
            "点<b>「更多信息」→「仍要运行」</b>即可，自编译程序的正常现象。"
        ),
        H3("3.2　装完之后有什么"),
        TABLE([
            ["位置", "内容"],
            ["桌面", "「漫客工作台」快捷方式"],
            ["开始菜单", "同名快捷方式"],
            ["设置 → 应用", "可从这里卸载"],
            ["安装目录", "launcher 控制台脚本、scripts 部署工具、node 便携运行时（自带，不用另装 Node）"],
        ], [45, 125]),
        H3("3.3　控制台长什么样"),
        P(
            "双击桌面图标打开，会看到「服务控制台」。它显示三个服务："
            "<b>ComfyUI</b>（8188，推理后端）、<b>工作台</b>（3020，网页界面）、"
            "<b>AI 扩写</b>（在线 API 或本地 llama.cpp）。"
        ),
        IMG("06-services.png", "图 3-1　服务控制台：绿点表示运行中，可单独启停", 145),
        H3("3.4　一排按钮是干什么的"),
        TABLE([
            ["按钮", "作用", "什么时候用"],
            ["全部启动", "同时启动 ComfyUI 和工作台", "每次要用时"],
            ["全部停止", "关掉全部服务，释放显存", "用完想省电"],
            ["刷新", "重新检测端口状态", "状态显示不对时"],
            ["打开工作台", "用浏览器打开 3020", "想直接用网页"],
            ["一键部署", "解压部署包到指定硬盘", "第一次装，或换机器"],
            ["检查部署包", "校验分卷是否完整", "下载完之后"],
            ["ComfyUI 位置", "指定 ComfyUI 装在哪", "解压完部署包之后"],
            ["检查更新", "查有没有新版本", "偶尔点一下"],
            ["更新工作台", "只更新代码，不动 data", "有新版本时"],
            ["补齐依赖", "检查并下载缺失的模型/节点", "报错说缺文件时"],
        ], [34, 72, 64]),
        PageBreak(),
    ]


def part_deploy():
    return [
        H2("四、解压部署"),
        P(
            "这一步把 211 GB 的压缩包变成能运行的程序。"
            "<b>整个过程约 10 分钟，中途不要关闭窗口。</b>"
        ),
        H3("4.1　准备空间"),
        P(
            "解压后约占用 <b>212 GB</b>。请确认目标硬盘至少有 <b>230 GB</b> 空闲，"
            "留一点余量给之后的输出文件。"
        ),
        WARN(
            "最常见的失败原因就是空间不够：解压到一半报「磁盘空间不足」，留下半成品目录。"
            "发生这种情况删掉半成品重来即可，源分卷不受影响。<b>部署包本身还要占 211 GB，"
            "建议放在另一个盘。</b>"
        ),
        H3("4.2　执行解压"),
        P("<b>只需要对第一个分卷操作</b>，7-Zip 会自动按顺序接上后面 6 个。两种方式任选："),
        P("<b>方式 A：用控制台（推荐）</b>", "h3"),
        *STEPS([
            "打开控制台，点「<b>一键部署</b>」。",
            "在弹出的窗口里选目标硬盘。",
            "点「开始部署」，等进度条走完。",
        ]),
        P("<b>方式 B：手动用 7-Zip</b>", "h3"),
        *STEPS([
            "装一个 7-Zip（如果还没有）。",
            "右键 <code>manke-bundle.7z.001</code> →「7-Zip」→「<b>解压到指定文件夹</b>」。",
            "选一个分区根目录，比如 <code>D:\\</code>，确定。",
        ]),
        CODE("命令行等价写法（把 D:\\ 换成你的目标盘）：\n7z x manke-bundle.7z.001 -oD:\\"),
        H3("4.3　解压出来是什么结构"),
        P("解压完成后，目标盘会多出一个 <b>manke</b> 文件夹："),
        CODE(
            "D:\\manke\\\n"
            "   ComfyUI\\                 推理后端\n"
            "      main.py\n"
            "      python_embeded\\      便携 Python（不用另外装）\n"
            "      models\\              26 个模型，203.9 GB\n"
            "      custom_nodes\\        13 个节点包\n"
            "      user\\                你的工作流\n"
            "   workbench\\               工作台界面\n"
            "      package.json\n"
            "      .output\\"
        ),
        H3("4.4　告诉控制台 ComfyUI 在哪"),
        P("这一步<b>不能跳过</b>。控制台需要知道你把包装到了哪里。"),
        *STEPS([
            "打开控制台，点「<b>ComfyUI 位置</b>」。",
            "选到 <code>D:\\manke\\ComfyUI</code>（注意是 ComfyUI 这一层，不是 manke）。",
            "日志里出现「ComfyUI 位置已设为 ……」就成功了。",
        ]),
        TIP(
            "控制台会自动判断目录结构 —— 无论是部署包这种 <code>manke\\ComfyUI\\main.py</code>，"
            "还是手动 git 安装的 <code>ComfyUI\\ComfyUI\\main.py</code>，都能识别。"
        ),
        PageBreak(),
    ]


def part_first_run():
    return [
        H2("五、首次启动"),
        H3("5.1　启动服务"),
        P("控制台里点「<b>全部启动</b>」。两个服务会依次起来："),
        TABLE([
            ["服务", "端口", "启动耗时", "说明"],
            ["工作台", "3020", "约 5 秒", "网页界面，先起来"],
            ["ComfyUI", "8188", "约 25~55 秒", "加载节点和模型索引，慢一些"],
        ], [32, 24, 38, 76]),
        P(
            "两个服务的圆点都变绿、状态显示「运行中」就说明好了。"
            "ComfyUI 第一次启动会扫描 203 GB 的模型目录，之后会快很多。"
        ),
        WARN(
            "如果 ComfyUI 一直停在「启动中」，点控制台的「<b>打开日志目录</b>」，"
            "看 <code>comfyui.err.log</code> 的最后几行 —— 通常那里直接写明原因。"
        ),
        H3("5.2　打开工作台"),
        P("点「<b>打开工作台</b>」按钮，浏览器会打开 <code>http://127.0.0.1:3020/zh</code>。"),
        IMG("01-home.png", "图 5-1　工作台首页", 165),
        H3("5.3　第一次用，先做个自检"),
        P(
            "切到「服务控制台」页面（顶部菜单或访问 <code>/zh/services</code>），"
            "找到「环境自检」，点「检查」。它会逐项核对构建产物、依赖、ComfyUI 位置、"
            "解释器、服务连通性、工作流模板、节点包、模型文件。<b>目标是全绿</b>。"
        ),
        IMG("06-services.png", "图 5-2　环境自检，各项通过就是「可以开工」", 145),
        TABLE([
            ["结果", "含义", "怎么办"],
            ["全部通过", "可以开工了", "直接开始创作"],
            ["有警告", "能跑，但某些模型缺失", "用到那个模型时会报错，可以先不管"],
            ["有失败", "缺关键文件", "点「补齐依赖」或按提示手动补"],
        ], [34, 68, 68]),
        PageBreak(),
    ]


def part_features():
    return [
        H2("六、功能详解"),

        H3("6.1　创作台：主力工作区"),
        P(
            "顶部菜单点「<b>创作</b>」进入。这是你 90% 时间会待的地方。"
            "第一次进来会弹出「开始新项目」，三个选项："
        ),
        IMG("02-studio.png", "图 6-1　开始新项目：创作台、基本画布，或 AI 短剧模式", 145),
        TABLE([
            ["入口", "用途"],
            ["创作台", "单张图 / 单条视频的生成，参数最全"],
            ["基本画布", "空白画布，自己拖图排版"],
            ["AI 短剧模式", "按镜头批量生成，自动拼接成片"],
        ], [40, 130]),
        P("<b>创作台的界面分区</b>", "h3"),
        *STEPS([
            "<b>中间输入区</b>：写提示词。右下角是字数计数和发送键。",
            "<b>底部左侧「媒体」</b>：切图片 / 视频 / 音乐。切换会换掉可选的模型。",
            "<b>底部「模型」下拉</b>：选具体工作流，比如 Qwen-Image 2.1、MiniMax H3。",
            "<b>输入框右上「AI 扩写」</b>：把一句简短描述扩成完整提示词。",
            "<b>右侧参数面板</b>：随模型变化，常见的有画幅、时长、种子、质量。",
        ]),
        TIP(
            "不知道写什么？在首页直接写一句话回车也行 —— 首页输入框和创作台是同一套引擎，"
            "只是参数用了默认值。"
        ),

        H3("6.2　AI 扩写：一句话变专业提示词"),
        P(
            "写「一个女孩在窗边看书」，点「<b>AI 扩写</b>」，它会补成：光线、镜头、构图、材质、"
            "色调全都写进去。扩写结果会覆盖输入框，<b>还可以继续手动改</b>。"
        ),
        P("扩写按媒体类型走不同的提示词规范："),
        TABLE([
            ["类型", "输出格式"],
            ["图片", "Qwen-Image 2.1 自然语言风格（中文 / 英文可选）"],
            ["视频", "MiniMax H3 六段式结构化描述（英文）"],
        ], [40, 130]),
        P("<b>第一次用需要配置服务</b>", "h3"),
        P(
            "扩写需要一个 OpenAI 兼容的大模型接口。到「服务控制台」页面，"
            "找到「<b>AI 扩写服务</b>」区块："
        ),
        *STEPS([
            "点一个预设（DeepSeek / Moonshot / OpenAI / SiliconFlow），地址和模型名自动填好。",
            "填入你从对应平台申请的 <b>API Key</b>。",
            "点「保存」，状态变成「可连接」就能用了。",
        ]),
        NOTE(
            "Key 只保存在本机 <code>data/llm.config.json</code>，不会上传到任何地方。"
            "界面上只显示「已保存」，从不回显 Key 本身。"
        ),

        H3("6.3　音乐工作台：写歌和翻唱"),
        P(
            "媒体切到「<b>音乐</b>」后，模型有两个：<b>YuE2 歌曲创作</b> 和 <b>YuE2 歌曲翻唱</b>。"
            "这两个的输入框装的都是<b>歌词</b>，不是描述。"
        ),
        TABLE([
            ["模式", "你要做", "输入框写什么"],
            ["歌曲创作", "选风格，写歌词", "歌词（每行一句，可用 [verse] [chorus] 分段）"],
            ["歌曲翻唱", "上传源歌曲，写新歌词", "要唱的歌词；留空则沿用原曲"],
        ], [30, 60, 80]),
        P("<b>风格面板怎么调</b>", "h3"),
        *STEPS([
            "<b>风格配方</b>：选一个现成组合（华语流行、古风、摇滚……），下面的参数自动填好。",
            "<b>演唱语言 / 音乐风格</b>：中文 / 英文 / 日文，以及大的流派方向。",
            "<b>情绪氛围 / 速度 / BPM</b>：想精确控制节奏就调 BPM，否则留「不指定」。",
            "<b>人声 / 编曲 / 高级</b>：更细的参数，一般不用动。",
        ]),
        P("<b>不会写歌词？</b>面板右上角有两个帮手："),
        TABLE([
            ["按钮", "作用"],
            ["插入结构模板", "自动生成 [Intro] [Verse] [Chorus] [Outro] 骨架，往里填词"],
            ["歌词示例", "8 个现成示例，选一个会同时写入歌词和配套风格"],
        ], [40, 130]),
        TIP(
            "生成一首歌约 2~4 分钟。结果是 mp3 文件，会出现在结果区，"
            "可以直接播放、下载，或者拖进画布。"
        ),

        H3("6.4　视频生成"),
        P("媒体切到「<b>视频</b>」，能看到几类工作流："),
        TABLE([
            ["模型", "特点", "适合"],
            ["MiniMax H3", "单段生成，一句描述出一个镜头", "快速试效果"],
            ["H3 导演·连贯成片", "一段提示词出连贯长镜头，可逐段写不同提示词", "有剧本的短镜头"],
            ["H3 无限分段", "每段独立提示词，段间尾帧续写，支持 8 张人物参考图锁脸", "短剧、系列内容"],
            ["Seedance / Veo / Kling", "其他厂商风格", "特定画风需求"],
        ], [46, 84, 40]),
        P("<b>怎么让视频里的人物一致</b>", "h3"),
        P(
            "用「H3 无限分段」工作流，最多上传 8 张人物参考图，"
            "然后在每段提示词里用 <code>&lt;Picture 1&gt;</code> 到 "
            "<code>&lt;Picture 8&gt;</code> 指代对应的人。"
        ),
        CODE(
            "示例提示词：\n"
            "<Picture 1> 走进咖啡馆，环顾四周，坐下\n"
            "<Picture 2> 从吧台后面抬头，微笑打招呼"
        ),
        P("<b>关于时长</b>", "h3"),
        P(
            "默认 5 秒。分段的模型可以每段单独设 1~60 秒。"
            "注意：<b>时长越长，出片越慢，也越容易崩</b>。做测试先用 5 秒。"
        ),

        H3("6.5　短剧模式"),
        P(
            "画布或项目里新建时选「<b>AI 短剧模式</b>」。它和普通创作的区别是："
            "<b>一次写多个镜头，批量生成，最后拼成一条完整视频</b>。"
        ),
        *STEPS([
            "给每个镜头写一句话描述（像写分镜脚本）。",
            "给每个镜头设时长。",
            "点生成，工作台会依次跑完所有镜头。",
            "跑完后在画布上按顺序排列，导出成片。",
        ]),
        TIP(
            "镜头之间想接得自然，就在后一个镜头的描述里带上「延续上一个镜头的场景 / 动作」。"
            "「H3 无限分段」还能用尾帧续写，接得更顺。"
        ),

        H3("6.6　素材分析（反推提示词）"),
        P(
            "媒体切到「视频」后，模型下拉里有一组「<b>素材分析</b>」选项。"
            "上传一张图或一段视频，它会把画面拆解成提示词。"
        ),
        TABLE([
            ["模式", "输出"],
            ["标准", "一段完整提示词，直接能用"],
            ["深度", "分维度拆解：主体、环境、光线、镜头、色调，逐项说明"],
        ], [30, 140]),
        P("<b>典型用法</b>", "h3"),
        *STEPS([
            "看到一张喜欢的图，存下来。",
            "用素材分析反推出提示词。",
            "把提示词拿去生成，换个主体或换套颜色，就成了自己的作品。",
        ]),

        H3("6.7　画布"),
        P(
            "顶部菜单「<b>画布</b>」。这是自由排版区：把生成的图、视频、音频都拖进来，"
            "随便摆、缩放、叠放，最后导出一张合成图或一条完整视频。"
        ),
        IMG("03-canvas.png", "图 6-2　画布列表", 150),
        TABLE([
            ["能做什么", "说明"],
            ["自由摆放", "拖动、缩放、旋转，像用画图软件一样"],
            ["多素材混排", "图片、视频、文字、形状都能放"],
            ["导出", "整张画布导出成 PNG，或按时间轴导出视频"],
            ["复用", "画布本身可以保存，下次接着改"],
        ], [40, 130]),

        H3("6.8　项目"),
        P(
            "顶部菜单「<b>项目</b>」。每个生成任务都属于一个项目，"
            "项目把你的图、视频、文案、参数配置全部归档在一起。"
        ),
        IMG("04-projects.png", "图 6-3　项目列表", 150),
        P(
            "好处是：做一个系列内容时，所有素材和配置都在一个项目里，"
            "换机器或过几个月回来，打开项目就能接着做。"
        ),

        H3("6.9　素材库"),
        P(
            "顶部菜单「<b>素材</b>」。所有生成过的图、视频、音频都自动存进这里，"
            "按时间倒序排列，可以搜索、筛选、批量操作。"
        ),
        IMG("05-assets.png", "图 6-4　素材库", 150),
        TABLE([
            ["功能", "说明"],
            ["自动归档", "每次生成的结果自动入库，不用手动保存"],
            ["筛选", "按类型（图 / 视频 / 音频）、按项目筛选"],
            ["复用", "拖到画布、下载、或复制参数再生成一次"],
        ], [34, 136]),

        H3("6.10　界面设置"),
        P("右上角几个按钮："),
        TABLE([
            ["按钮", "作用"],
            ["ZH 下拉", "切换界面语言（中文 / English / 日本語）"],
            ["太阳 / 月亮", "切换浅色 / 深色主题"],
            ["显示器图标", "跟随系统主题"],
        ], [40, 130]),
        PageBreak(),
    ]


def part_troubleshoot():
    return [
        H2("七、常见问题"),
        P("按现象查。每条都指向具体动作。"),

        H3("7.1　服务起不来"),
        TABLE([
            ["现象", "原因", "怎么办"],
            [
                "点「全部启动」后一直停在「启动中」",
                "启动包装器丢失（重装后常见）",
                "关掉控制台重新打开，它会自动修复；仍不行就重装控制台",
            ],
            [
                "工作台起来了，ComfyUI 起不来",
                "ComfyUI 位置没设对",
                "点「ComfyUI 位置」重新选到 manke\\\\ComfyUI",
            ],
            [
                "ComfyUI 报 ModuleNotFoundError",
                "解压不完整，或用了旧版部署包",
                "确认用的是 211 GB 的新包；旧包缺库目录",
            ],
            [
                "ComfyUI 崩溃无输出",
                "节点打印 emoji，GBK 编码不支持",
                "用控制台启动（已设 PYTHONUTF8）；手动启动要加 -X utf8",
            ],
        ], [50, 50, 70]),

        H3("7.2　生成失败"),
        TABLE([
            ["现象", "原因", "怎么办"],
            [
                "报「模型不可用」",
                "工作流需要的模型没装",
                "点「补齐依赖」，或看错误里写的文件名手动补",
            ],
            [
                "报「ComfyUI 拒绝了这个工作流」",
                "缺模型或参数越界",
                "错误信息里会写明是哪个节点、哪个值",
            ],
            [
                "音乐生成完但界面没显示",
                "旧版把音频当图片处理、超限丢弃",
                "用新版工作台；音频现在有独立的 256 MB 上限",
            ],
            [
                "生成很慢 / 显存不足",
                "模型太大或并行任务太多",
                "先停掉别的服务；视频先用 5 秒试",
            ],
        ], [50, 50, 70]),

        H3("7.3　AI 扩写不可用"),
        P("扩写走在线 API，需要三样东西对：接口地址、API Key、模型名。"),
        *STEPS([
            "到「服务控制台」→「AI 扩写服务」，看状态是不是「无法连接」。",
            "点「重新检测」，看提示的具体错误 —— HTTP 401 是 Key 不对，404 是模型名不对。",
            "确认接口地址以 <code>/v1</code> 结尾，比如 <code>https://api.deepseek.com/v1</code>。",
        ]),

        H3("7.4　磁盘与管理"),
        TABLE([
            ["问题", "说明"],
            ["解压后占多少", "约 212 GB"],
            ["分卷能删吗", "能。解压并验证通过后可以删掉 7 个分卷，省 211 GB"],
            ["怎么卸载", "设置 → 应用 → 漫客工作台控制台 → 卸载；或用安装目录的「卸载.vbs」"],
            ["卸载会删作品吗", "默认不删 data 目录，作品和配置保留"],
        ], [46, 124]),

        H3("7.5　彻底重来"),
        P("如果环境彻底乱了，按这个顺序重来最干净："),
        *STEPS([
            "控制台点「全部停止」。",
            "卸载控制台（设置 → 应用）。",
            "删掉 manke 目录（如果还想保留作品，先备份其中的 <code>workbench\\\\data</code>）。",
            "重新解压部署包。",
            "重新安装控制台，重新指定 ComfyUI 位置。",
        ]),
        NOTE(
            "<b>关于数据安全</b>：所有生成结果、项目、素材都在 <code>workbench/data</code> 里，"
            "不在 ComfyUI 目录。重装或替换 ComfyUI 不会丢作品。"
        ),
        PageBreak(),
    ]


def part_reference():
    end = ParagraphStyle("end", fontName="YaHeiBold", fontSize=12, alignment=TA_CENTER)
    endnote = ParagraphStyle(
        "endnote", fontName="YaHei", fontSize=9.5, alignment=TA_CENTER, textColor=MUTED
    )
    return [
        H2("附录　速查表"),
        H3("A. 关键路径"),
        TABLE([
            ["路径", "是什么"],
            ["D:\\\\manke\\\\ComfyUI", "推理后端根目录（盘符换成你的）"],
            ["D:\\\\manke\\\\workbench", "工作台源码"],
            ["D:\\\\manke\\\\workbench\\\\data", "作品、项目、素材、配置（重要）"],
            ["%LOCALAPPDATA%\\\\Programs\\\\漫客工作台", "控制台安装目录"],
            ["控制台 → 打开日志目录", "所有服务日志"],
        ], [66, 104]),
        H3("B. 端口"),
        TABLE([
            ["端口", "服务", "访问地址"],
            ["3020", "工作台网页", "http://127.0.0.1:3020/zh"],
            ["8188", "ComfyUI 后端", "http://127.0.0.1:8188"],
        ], [26, 52, 92]),
        H3("C. 关键环境变量"),
        TABLE([
            ["变量", "作用", "默认值"],
            ["PORT", "工作台端口", "3020"],
            ["BEATDESIGN_COMFYUI_HOME", "ComfyUI 根目录", "从配置读"],
            ["PYTHONUTF8", "让 Python 用 UTF-8", "必须为 1"],
            ["BEATDESIGN_LLM_BASE_URL", "AI 扩写接口", "从配置读"],
            ["BEATDESIGN_LLM_API_KEY", "AI 扩写密钥", "从配置读"],
        ], [54, 62, 54]),
        H3("D. 一次完整的创作流程"),
        *STEPS([
            "打开控制台 → 全部启动 → 等两个绿灯。",
            "点「打开工作台」。",
            "创作 → 选媒体类型 → 选模型。",
            "写提示词（或点 AI 扩写）。",
            "按需上传参考图 / 参考音频。",
            "调参数（画幅、时长、种子）。",
            "点生成，等结果。",
            "结果自动进素材库；拖进画布继续加工，或直接下载。",
        ]),
        Spacer(1, 12),
        Paragraph("— 教程结束 —", end),
        Spacer(1, 4),
        Paragraph("遇到本教程没覆盖的问题：控制台 → 打开日志目录，把报错发出来。", endnote),
    ]


def main():
    out = DOCS / "漫客工作台-完整图文教程.pdf"
    doc = Doc(out, "漫客工作台 · 完整图文教程")

    story = []
    story += cover()
    story += part_intro()
    story += part_download()
    story += part_install()
    story += part_deploy()
    story += part_first_run()
    story += part_features()
    story += part_troubleshoot()
    story += part_reference()

    doc.build(story)
    size = out.stat().st_size / 1024
    print(f"  完成: {out}")
    print(f"  大小: {size:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
