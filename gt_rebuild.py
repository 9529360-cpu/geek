# 群组工具 6 Tab 重做
s = open('ui/index.html', encoding='utf-8').read()
start = s.find('<!-- 群组工具（原版级：编辑/克隆/解散/退出/链接） -->')
if start == -1:
    start = s.find('<!-- 群组工具（克隆/解散/退出——真实 WA API） -->')
end = s.find('<!-- 批量加入群组弹窗 -->', start)
print('段:', start, end)
new_html = open('gt_new.html', encoding='utf-8').read()
s = s[:start] + new_html + '\n' + s[end:]
open('ui/index.html', 'w', encoding='utf-8').write(s)
print('群组工具 6 Tab 重做完成')
