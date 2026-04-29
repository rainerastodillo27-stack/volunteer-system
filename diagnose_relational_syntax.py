from pathlib import Path
from collections import Counter

path = Path('backend/relational_mirror.py')
text = path.read_text()
lines = text.splitlines()
for i, line in enumerate(lines, start=1):
    if '"""' in line or "'''" in line:
        print(f"LINE {i}: {line!r}")

print('---')
for i, line in enumerate(lines, start=1):
    if line.strip().startswith('f"""') or line.strip().startswith('"""'):
        print(i, line)

print('---')
# find unbalanced parentheses and brackets roughly
stack = []
for i, line in enumerate(lines, start=1):
    for ch in line:
        if ch in '([{':
            stack.append((ch, i, line))
        elif ch in ')]}':
            if not stack:
                print('UNBALANCED close', ch, i)
                break
            open_ch, oi, _ = stack.pop()
            if (open_ch, ch) not in [('(', ')'), ('[', ']'), ('{', '}')]:
                print('MISMATCH', open_ch, 'at', oi, 'with', ch, 'at', i)
                break
print('stack remaining', len(stack))
if stack:
    for ch, i, line in stack[-10:]:
        print('OPEN', ch, 'at', i, line)
