# 生成《漫客工作台 · 完整图文教程》PDF
#
#   python scripts\make-tutorial-pdf.py
#
# 覆盖：安装 → 下载部署包 → 一键部署 → 确认环境 → 开始创作 → 服务控制台
#      → 常见问题 → 卸载。
# 截图来自 docs/tutorial-images/，都是真实运行的界面。

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "tutorial-images"
OUT = ROOT / "docs" / "漫客工作台-完整图文教程.pdf"

pdfmetrics.registerFont(TTFont("YaHei", r"C:\Windows\Fonts\msyh.ttc"))
pdfmetrics.registerFont(TTFont("YaHeiBold", r"C:\Windows\Fonts\msyhbd.ttc"))

INK = colors.HexColor("#1C1917")
ACCENT = colors.HexColor("#C2410C")
MUTED = colors.HexColor("#78716C")
BG = colors.HexColor("#F5F2EE")

PAGE_W, PAGE_H = A4
MARGIN = 2.2 * cm
CONTENT_W = PAGE_W - MARGIN * 2

S = {
    "title": ParagraphStyle(
        "title", fontName="YaHeiBold", fontSize=38, leading=50,
        textColor=INK, alignment=TA_CENTER,
    ),
    "subtitle": ParagraphStyle(
        "subtitle", fontName="YaHeiBold", fontSize=16, leading=24,
        textColor=ACCENT, alignment=TA_CENTER, spaceBefore=8,
    ),
    "meta": ParagraphStyle(
        "meta", fontName="YaHei", fontSize=10.5, leading=20,
        textColor=MUTED, alignment=TA_CENTER,
    ),
    "h1": ParagraphStyle(
        "h1", fontName="YaHeiBold", fontSize=18, leading=26,
        textColor=ACCENT, spaceAfter=12,
    ),
    "h2": ParagraphStyle(
        "h2", fontName="YaHeiBold", fontSize=13, leading=20,
        textColor=INK, spaceBefore=12, spaceAfter=6,
    ),
    "body": ParagraphStyle(
        "body", fontName="YaHei", fontSize=10.5, leading=18,
        textColor=INK, spaceAfter=8,
    ),
    "caption": ParagraphStyle(
        "caption", fontName="YaHei", fontSize=9, leading=14,
        textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=14,
    ),
    "note": ParagraphStyle(
        "note", fontName="YaHei", fontSize=10, leading=17,
        textColor=INK, backColor=BG, borderPadding=(8, 10, 8, 10),
        spaceBefore=6, spaceAfter=12,
    ),
    "bullet": ParagraphStyle(
        "bullet", fontName="YaHei", fontSize=10.5, leading=17, textColor=INK,
    ),
    "mono": ParagraphStyle(
        "mono", fontName="YaHei", fontSize=11, leading=19,
        textColor=INK, spaceAfter=2,
    ),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items):
    return ListFlowable(
        [ListItem(P(t, "bullet"), leftIndent=14) for t in items],
        bulletType="bullet", leftIndent=16, bulletFontSize=6, spaceAfter=8,
    )


def shot(name, caption):
    """截图 + 图注，按版心等比缩放。

    小图直接用（允许和后面的文字排在同一页），超过一页高度的才单独占页 ——
    全部包 KeepTogether 会让半页空白，整本看着很碎。
    """
    path = IMG / name
    if not path.exists():
        return Spacer(1, 0)
    iw, ih = ImageReader(str(path)).getSize()
    w = CONTENT_W
    h = ih * (w / iw)
    # 图不超过页高的 58%：留出标题、正文和图注的空间，避免整块被推到下一页
    max_h = (PAGE_H - MARGIN * 2) * 0.58
    if h > max_h:
        h = max_h
        w = iw * (h / ih)
    img = Image(str(path), width=w, height=h)
    cap = P(caption, "caption")
    # 图 + 图注绑在一起绝不拆页。
    # 前面垫一个弹性间隔，让 reportlab 把整块往下推而不是硬切 —— 否则图注
    # 常常和它的图被分到两页。
    return [Spacer(1, 2), KeepTogether([img, cap])]


def _flat(item):
    """shot() 可能返回单个 Flowable，也可能返回列表，统一成列表。"""
    if isinstance(item, list):
        return item
    return [item]


def h1(t):
    return P(t, "h1")


def h2(t):
    return P(t, "h2")


def note(t):
    return P(t, "note")


story = []

# ══ 封面
story.append(Spacer(1, 4.5 * cm))
story.append(P("漫客工作台", "title"))
story.append(P("完整安装与使用教程", "subtitle"))
story.append(Spacer(1, 1.5 * cm))
story.append(P("版本 0.4.0　·　Windows 10 / 11　·　NVIDIA 显卡", "meta"))
story.append(Spacer(1, 3.5 * cm))
story.append(P("本地跑 ComfyUI，出图、出片、出歌都不上传云端。<br/>装一次，之后一直用。", "meta"))
story.append(PageBreak())

# ══ 概览
story.append(h1("这份教程讲什么"))
story.append(P(
    "整套东西分两部分：一个 661 MB 的程序（装完就有完整界面），"
    "和一份 181 GB 的部署包（ComfyUI 本体 + 模型）。"
    "下面按顺序走一遍，从零到能出图大约 30 分钟，其中 20 分钟是等下载。"
))
story.append(bullets([
    "第 1 步　安装程序（可选安装位置）",
    "第 2 步　下载部署包（夸克网盘，9 个独立压缩包）",
    "第 3 步　一键部署（软件内点按钮，自动解压和配置）",
    "第 4 步　确认环境（自检全绿就开始用）",
    "第 5 步　开始创作（创作台 / 项目 / 素材）",
    "第 6 步　认识服务控制台",
    "常见问题　·　卸载方式",
]))
story.append(note(
    "硬件要求：NVIDIA 显卡，显存 8 GB 起（12 GB 更舒服）。"
    "磁盘要留 220 GB 以上给部署包。AMD 显卡这套跑不了。"
))
story.append(PageBreak())

# ══ 1
story.append(h1("第 1 步　安装程序"))
story.append(P(
    "程序本体 661 MB。里面有界面、本地服务、22 个工作流模板，"
    "还有 74 个自定义节点包 —— ComfyUI 靠这些节点才能认出各种模型。"
))
story.append(h2("1.1 双击安装包"))
story.append(P("文件名 manke-workbench-setup-0.4.0.exe。双击后会问你想装在哪。"))
story.append(h2("1.2 选安装位置"))
story.append(P(
    "安装向导第一屏就是选位置，默认在 C 盘用户目录下。"
    "C 盘空间紧张就改成 D 盘或其他盘，程序本身只占约 700 MB。"
))
story.append(note(
    "这里选的只是「程序」的位置，ComfyUI 和模型另算（第 3 步会让你选解压目录）。"
    "两个位置可以不在同一个盘。"
))
story.append(h2("1.3 装完会自动启动"))
story.append(P(
    "装完程序自己打开。第一次会进引导页，问你 ComfyUI 在哪 —— "
    "这时候部署包还没下载，点「稍后再说，先看看界面」跳到主界面即可。"
))
story.append(PageBreak())

# ══ 2
story.append(h1("第 2 步　下载部署包"))
story.append(P(
    "181 GB，分 9 个独立压缩包。用夸克网盘下载，三个地方都能拿到链接："
    "引导页的「下载一键部署包」、控制台的「打开下载页」、或直接打开下面的地址。"
))
story.append(h2("2.1 链接和提取码"))
story.append(P("链接：https://pan.quark.cn/s/41fbf0e530ca", "mono"))
story.append(P("提取码：~fe853c1j5d~:/", "mono"))
story.append(note(
    "网盘客户端比浏览器快得多 —— 浏览器下 181 GB 容易断。"
    "建议用夸克客户端，支持断点续传。"
))
story.append(h2("2.2 9 个包必须放同一个目录"))
story.append(P("下载下来的文件长这样，全部放在一个文件夹里，文件名一个都不能改："))
story.append(bullets([
    "01-python.7z　　　　3.2 GB　　便携 Python 运行环境",
    "02-comfyui.7z　　 105 MB　　ComfyUI 本体 + 示例素材",
    "03-minimax-big.7z　28.6 GB　MiniMax 视频模型",
    "04-minimax-a.7z　　35.0 GB",
    "05-minimax-b.7z　　17.5 GB",
    "06-qwen-a.7z　　　 5.5 GB　　Qwen 图像模型",
    "07-qwen-b.7z　　　17.6 GB",
    "08-text-encoders.7z 27.9 GB　文本编码器",
    "09-models-rest.7z　45.9 GB　其余模型（含 TTS、人脸检测）",
    "manifest.json　　　　　　　 包清单，工作台靠它核对",
]))
story.append(note("manifest.json 一定要留着。工作台靠它知道「齐了没有」，删了会认不出包。"))
story.append(P("目录名没有规定，随手建一个就行，比如 E:\\manke-bundles。第 3 步会让你选这个目录。"))
story.append(PageBreak())

# ══ 3
story.append(h1("第 3 步　一键部署"))
story.append(P("这一步把 9 个包解压成能跑的 ComfyUI，并自动配好路径。开头 30 秒，剩下都在等解压。"))
story.append(h2("3.1 打开服务控制台"))
story.append(P("主界面右上角导航栏点「服务控制台」。"))
story.extend(shot("01-home.png", "主界面：顶栏有「服务控制台」入口，右上角是 ComfyUI 连接状态") or [])
story.append(h2("3.2 填两个目录"))
story.append(P(
    "控制台往下滚找到「一键部署」。第一行填 9 个包所在的目录"
    "（点「选择目录」直接选）；第二行填解压到哪 —— 这个盘要留 220 GB 以上空余。"
))
story.extend(shot("07-deploy-panel.png", "一键部署面板：上面填包所在目录，下面填解压目标") or [])
story.append(h2("3.3 点「重新检查」确认包齐全"))
story.append(P(
    "填完点「重新检查」。都齐了会显示「9 个包齐全（181.29 GB）」，"
    "缺哪个会直接告诉你缺哪个文件。"
))
story.extend(shot("08-deploy-checked.png", "检查通过后会列出包数量和总大小") or [])
story.append(h2("3.4 点「开始部署」"))
story.append(P(
    "之后就不用管了。软件会按顺序解 9 个包，界面上有进度条，"
    "每个包解完都会提示 —— 这时候可以把这个 .7z 删掉腾空间。"
    "全程约 8 到 20 分钟，取决于硬盘速度。"
))
story.append(note(
    "解压期间别关软件。万一关了，下次打开会问你要不要继续 —— "
    "已经解出来的文件会跳过，不会重来。"
))
story.append(P(
    "解完会自动做三件事：写入 ComfyUI 路径 → 把 74 个节点包补齐到 custom_nodes → "
    "启动 ComfyUI。全做完界面上会显示「部署完成，ComfyUI 已就绪」。"
))
story.append(PageBreak())

# ══ 4
story.append(h1("第 4 步　确认环境"))
story.append(P("部署完，控制台里有一块「环境自检」，逐项告诉你哪里配好了、哪里还差。全绿就可以开工。"))
story.extend(shot("05-console.png", "服务控制台：三个服务的运行状态和启停按钮") or [])
story.append(h2("自检里每项看什么"))
story.append(bullets([
    "ComfyUI 位置 —— 显示你选的路径和「来源」，来源应该是 data/comfyui.config.json",
    "ComfyUI 解释器 —— 指向 &lt;你选的目录&gt;\\python_embeded\\python.exe",
    "ComfyUI 服务 —— 显示可访问 + 显存大小，说明服务真的跑起来了",
    "工作流模板 —— 22 个",
    "模型文件 —— 29 / 29 就位",
]))
story.append(note(
    "如果 ComfyUI 服务那项显示「无响应」，去控制台顶部点「启动」，"
    "或者直接重启软件 —— 软件启动时会自动拉起 ComfyUI。"
))
story.append(PageBreak())

# ══ 5
story.append(h1("第 5 步　开始创作"))
story.append(h2("5.1 首页"))
story.append(P(
    "顶栏右侧那个状态徽标是 ComfyUI 的连接状态。显示「空闲 · 显存 x/y GB」就是好的；"
    "显示红色「ComfyUI 未连接」说明服务没起来，去控制台看一下。"
))
story.extend(shot("01-home.png", "首页：中间是输入框，下面是本机生成过的作品轮播") or [])
story.append(h2("5.2 创作台"))
story.append(P(
    "顶栏点「创作」。左边选模板（22 个），中间填提示词，右边出图。"
    "模板已经按用途分好：文生图、图像编辑、视频、音乐、语音。"
))
story.extend(shot("02-studio.png", "创作台：选模板 → 写提示词 → 生成") or [])
story.append(note(
    "编辑类模板（图像编辑、三视图、放大）需要先上传一张图；视频类模板可以只写提示词。"
    "模板自带的示例素材已经在部署包里，第一次打开就能直接点生成试试。"
))
story.append(h2("5.3 项目"))
story.append(P("「从上次停下的地方继续」—— 项目页把所有做过的整理在一起，点开接着干。生成的东西自动存进来，按时间排列。"))
story.extend(shot("03-projects.png", "项目页：所有生成记录") or [])
story.append(h2("5.4 素材"))
story.append(P("「所有生成的东西，都在这里」—— 图片、视频、音频统一管理，按类型筛选，可以下载、删除、加进项目。"))
story.extend(shot("04-assets.png", "素材库：按类型筛选") or [])
story.append(PageBreak())

# ══ 6
story.append(h1("第 6 步　服务控制台"))
story.append(P("日常用不太到，但出问题都在这儿查。三块内容："))
story.append(h2("6.1 服务状态"))
story.append(P(
    "三个服务各一张卡片：工作台本体、ComfyUI、AI 扩写。"
    "每张卡上有「启动 / 停止」和「打开」—— 点「打开」会在浏览器里打开对应地址。"
))
story.append(h2("6.2 ComfyUI 路径"))
story.append(P(
    "这里能改 ComfyUI 的位置。换盘、重装、或者指向已有的 ComfyUI，都在这一格改。"
    "改完点「保存」，软件会自动停掉旧的 ComfyUI，下次启动用新路径。"
))
story.extend(shot("06-comfy-path.png", "ComfyUI 路径可编辑，带「选择目录」和「保存」") or [])
story.append(h2("6.3 AI 扩写"))
story.append(P(
    "写提示词时点一下就能扩写成完整描述。支持 DeepSeek、Moonshot、OpenAI、"
    "SiliconFlow 等在线 API，也能接本地的 llama.cpp。Key 只存在本机，不上传。"
))
story.append(PageBreak())

# ══ FAQ
story.append(h1("常见问题"))
story.append(h2("顶部显示「ComfyUI 未连接」"))
story.append(P(
    "按顺序看：① 控制台里 ComfyUI 卡片是不是「运行中」；② 是的话点「重启」；"
    "③ 还不行就看 ComfyUI 日志（控制台底部）。"
    "软件启动时会自动拉起 ComfyUI，通常等半分钟就好 —— 加载模型要时间。"
))
story.append(h2("生成时报 missing_node_type"))
story.append(P(
    "说明节点包没补齐。重启软件，日志里会写「节点包: 补齐 N 个」。"
    "如果一直补齐不了，检查安装目录下的 resources\\nodes 是否完整。"
))
story.append(h2("生成报 Invalid image file"))
story.append(P(
    "模板引用的示例素材不在。正常部署包里带了 32 个示例文件；"
    "如果手动挪过 input 目录，把它们放回去就行。"
))
story.append(h2("换了台电脑，能直接把程序拷过去吗"))
story.append(P(
    "程序可以拷，部署包（181 GB）建议重下一次。程序本身不记绝对路径 —— "
    "换机器后打开会问你 ComfyUI 在哪，指过去就行。"
))
story.append(h2("怎么更新软件"))
story.append(P(
    "软件启动 10 秒后会自动检查有没有新版本，有的话后台下载，"
    "下完弹窗问你要不要现在重启。不用自己去找安装包。"
))
story.append(PageBreak())

# ══ 卸载
story.append(h1("卸载与清理"))
story.append(P(
    "卸载程序不会删你的作品，也不会删 ComfyUI 和模型 —— 那些是独立的数据。"
    "想彻底清干净，按下面顺序来。"
))
story.append(h2("7.1 卸载程序"))
story.append(P(
    "两个办法选一个：Windows 设置 → 应用 → 找到「漫客工作台」→ 卸载；"
    "或者直接跑安装目录里的 Uninstall 漫客工作台.exe。"
))
story.append(h2("7.2 删用户数据（作品、项目、配置）"))
story.append(P("路径：%APPDATA%\\漫客工作台。删掉它，作品和配置一起没。"))
story.append(h2("7.3 删 ComfyUI 和模型"))
story.append(P("就是你第 3 步选的那个解压目录。181 GB 全在里面，直接整个文件夹删掉。"))
story.append(h2("7.4 清缓存"))
story.append(P(
    "程序会在 %LOCALAPPDATA%\\manke-workbench-updater 留一份更新包（约 660 MB），"
    "卸载时通常一起删；没删的话手动清掉。"
))
story.append(note(
    "只想换版本、不想重下部署包的话：卸载程序 → 装新版 → 打开就行。"
    "ComfyUI 路径会从配置里读回来，不用重新部署。"
))


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("YaHei", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(PAGE_W / 2, 1.3 * cm, f"漫客工作台 · 完整图文教程　　{doc.page}")
    canvas.restoreState()


def first_page(canvas, doc):
    pass


doc = SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=MARGIN,
    rightMargin=MARGIN,
    topMargin=2.0 * cm,
    bottomMargin=2.0 * cm,
    title="漫客工作台 · 完整图文教程",
    author="漫客工作台",
)
doc.build(story, onFirstPage=first_page, onLaterPages=on_page)

print(f"已生成 {OUT.name}")
print(f"大小 {OUT.stat().st_size / 1024:.0f} KB")
