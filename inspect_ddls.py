from pathlib import Path
import ast

text = Path('backend/relational_mirror.py').read_text()
# parse manually by finding RELATIONAL_TABLE_DDL list start/end
start = text.find('RELATIONAL_TABLE_DDL = [')
if start == -1:
    raise SystemExit('RELATIONAL_TABLE_DDL not found')
sub = text[start:]
end = sub.find('\n]\n')
if end == -1:
    raise SystemExit('end of list not found')
list_text = sub[:end+3]

# use ast to parse only the list text
code = 'x = ' + list_text.split('RELATIONAL_TABLE_DDL = ',1)[1]
try:
    tree = ast.parse(code)
    val = tree.body[0].value
    assert isinstance(val, ast.List)
    items = []
    for elt in val.elts:
        if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
            items.append(elt.value)
        else:
            raise SystemExit('Non-constant item found')
    for idx, item in enumerate(items):
        print(idx, len(item), repr(item[:80]).replace('\n','\\n'))
except SyntaxError as e:
    print('Parse error', e)
    raise
