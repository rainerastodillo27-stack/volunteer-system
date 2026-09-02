import os
import re

def generate():
    with open('WHITE_BOX_TESTING.md', 'r', encoding='utf-8') as f:
        md = f.read()

    use_cases = re.findall(r'## (Use Case \d+: [^\n]+)\n\n(\|.+?)(?=\n---|\n# White-Box Testing Coverage|$)', md, re.DOTALL)

    html_cards = []
    tbl_no = 66
    for uc_title, table_md in use_cases:
        lines = [l.strip() for l in table_md.strip().split('\n') if l.strip()]
        headers = [c.strip() for c in lines[0].split('|')[1:-1]]
        data_rows = lines[2:]
        
        rows_html = []
        for r in data_rows:
            cols = [c.strip() for c in r.split('|')[1:-1]]
            actual_content = cols[5]
            if '[LOG:' in actual_content:
                p1, p2 = actual_content.split('[LOG:', 1)
                act_formatted = f'{p1.strip()}<div class="terminal-log"><span class="log-prefix">[LOG:</span>{p2.strip()}</div>'
            else:
                act_formatted = actual_content
                
            rows_html.append(f'''
            <tr>
                <td style="font-weight: bold; text-align: center;">{cols[0]}</td>
                <td><code>{cols[1]}</code></td>
                <td>{cols[2]}</td>
                <td>{cols[3]}</td>
                <td>{cols[4]}</td>
                <td>{act_formatted}</td>
                <td style="text-align: center;"><span class="badge-pass">{cols[6]}</span></td>
                <td>{cols[7]}</td>
            </tr>''')
            
        header_th = "".join(f"<th>{h}</th>" for h in headers)
        body_tr = "".join(rows_html)
        sub_title = uc_title.split(': ', 1)[1] if ': ' in uc_title else uc_title
        html_cards.append(f'''
        <div class="section-card">
            <div style="font-weight: bold; font-size: 15px; color: #166534; margin-bottom: 4px;">Table {tbl_no}</div>
            <h2 style="margin-top: 0; font-size: 17px; color: #0f172a;">White-Box Testing – {sub_title}</h2>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>{header_th}</tr>
                    </thead>
                    <tbody>
                        {body_tr}
                    </tbody>
                </table>
            </div>
        </div>''')
        tbl_no += 1

    cards_joined = "".join(html_cards)

    full_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>White-Box Testing Documentation & Log Verification</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }}
    .container {{ max-width: 1380px; margin: 0 auto; }}
    .header {{ background: linear-gradient(135deg, #166534, #15803d); color: white; padding: 28px; border-radius: 12px; margin-bottom: 24px; }}
    .stats {{ display: flex; gap: 16px; margin-bottom: 24px; }}
    .stat-card {{ flex: 1; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }}
    .stat-num {{ font-size: 26px; font-weight: 800; color: #166534; }}
    .stat-lbl {{ font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-top: 4px; }}
    .section-card {{ background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.03); }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }}
    th, td {{ border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }}
    th {{ background: #f1f5f9; color: #334155; font-weight: 700; font-size: 11px; text-transform: uppercase; }}
    tr:nth-child(even) {{ background: #fbfcfe; }}
    .badge-pass {{ display: inline-block; background: #dcfce7; color: #15803d; font-weight: 700; padding: 2px 8px; border-radius: 12px; font-size: 11px; }}
    .terminal-log {{ background: #0f172a; color: #38bdf8; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; padding: 6px 8px; border-radius: 5px; font-size: 10.5px; margin-top: 6px; word-break: break-all; border-left: 3px solid #10b981; }}
    .log-prefix {{ color: #4ade80; font-weight: bold; }}
    code {{ background: #f1f5f9; padding: 2px 4px; border-radius: 4px; font-size: 11px; color: #0f172a; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0 0 6px 0;">White-Box Testing Documentation & Log Verification</h1>
      <p style="margin: 0; opacity: 0.9; font-size: 14px;">Internal Code Implementation Verification & Execution Path Traceability | Negrense Volunteers for Change (NVC Connect)</p>
    </div>
    
    <div class="stats">
      <div class="stat-card"><div class="stat-num">96</div><div class="stat-lbl">Total Test Cases</div></div>
      <div class="stat-card"><div class="stat-num" style="color: #16a34a;">96</div><div class="stat-lbl">Passed (100%)</div></div>
      <div class="stat-card"><div class="stat-num" style="color: #dc2626;">0</div><div class="stat-lbl">Failed (0%)</div></div>
      <div class="stat-card"><div class="stat-num">100%</div><div class="stat-lbl">Coverage Rate</div></div>
    </div>

    {cards_joined}
  </div>
</body>
</html>'''

    with open('WHITE_BOX_TEST_REPORT.html', 'w', encoding='utf-8') as f:
        f.write(full_html)

    print('Updated WHITE_BOX_TEST_REPORT.html successfully')

if __name__ == '__main__':
    generate()
