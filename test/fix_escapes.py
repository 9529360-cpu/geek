# 修复 app.js 指令段的双倍转义（4反斜杠 -> 2反斜杠）
src = open(r'D:\项目\whatsapp-multi-phase1\ui\app.js', encoding='utf-8').read()
start = src.find('// 指令：只处理群聊消息')
end_marker = '// 删除指令消息（apagarcomando'
end = src.find(end_marker)
end2 = src.find('deleteMessage(chatId, msg.id, false, true)', end)
end3 = src.find('\n', end2) + 1
seg = src[start:end3]
# 4 字面反斜杠 -> 2 字面反斜杠（python 源码中 '\\\\\\\\' 是 4 字面反斜杠，'\\\\' 是 2 字面反斜杠）
seg2 = seg.replace('\\\\\\\\', '\\\\')
src2 = src[:start] + seg2 + src[end3:]
open(r'D:\项目\whatsapp-multi-phase1\ui\app.js', 'w', encoding='utf-8', newline='').write(src2)

import re
seg3 = src2[start:src2.find(end_marker)]
count = len(re.findall(r'\\\\\\\\', seg3))
print('修复后指令段 4 反斜杠数:', count)
i = seg3.find("'Subject: *'")
print(repr(seg3[i:i+70]))
i2 = seg3.find('t.split')
print(repr(seg3[i2:i2+25]))
