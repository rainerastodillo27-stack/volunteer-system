import ast
import sys

try:
    with open('backend/relational_mirror.py', 'r') as f:
        code = f.read()
    ast.parse(code)
    print("✓ File is valid Python")
except SyntaxError as e:
    print(f"SyntaxError on line {e.lineno}: {e.msg}")
    if e.text:
        print(f"Text: {e.text}")
        if e.offset:
            print(" " * (e.offset - 1) + "^")
    sys.exit(1)
