"""Project scaffolds and file-name handling shared by project creation and import."""
import re
from pathlib import PurePosixPath

EXT_LANG = {
    "c": "c", "h": "c", "cpp": "cpp", "cc": "cpp", "cxx": "cpp", "hpp": "cpp", "lua": "lua", "py": "python",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript", "ts": "typescript", "html": "html", "htm": "html",
    "css": "css", "json": "json", "yaml": "yaml", "yml": "yaml", "sql": "sql", "md": "markdown", "sh": "shell",
    "java": "java", "go": "go", "rs": "rust", "txt": "text", "log": "text", "http": "http", "rest": "http",
    "xml": "xml", "properties": "properties", "toml": "toml",
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "target", "build", "dist", ".idea", ".vscode"}


def split_path(path):
    """('a/b/c.py') -> ('a/b', 'c', 'python'), or None when the type is unsupported."""
    p = PurePosixPath(path.replace("\\", "/"))
    if any(part in SKIP_DIRS or part in ("", ".", "..") for part in p.parts):
        return None
    language = EXT_LANG.get(p.suffix.lstrip(".").lower())
    stem = p.name[: -len(p.suffix)] if p.suffix else p.name
    if not language or not stem:
        return None
    return str(p.parent) if str(p.parent) != "." else "", stem[:100], language


def package_name(name):
    pkg = re.sub(r"[^A-Za-z0-9_]", "_", name.strip().lower()).strip("_") or "app"
    return pkg if not pkg[0].isdigit() else f"p_{pkg}"


DJANGO_SETTINGS = '''from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "dev-only-change-me"
DEBUG = True
ALLOWED_HOSTS = []
INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.staticfiles", "core"]
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "@PKG@.urls"
TEMPLATES = []
WSGI_APPLICATION = "@PKG@.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
'''

TEMPLATES = [
    {
        "id": "empty", "label": "Empty project", "group": "General",
        "desc": "A folder with nothing in it.", "files": {},
    },
    {
        "id": "python", "label": "Python script", "group": "Python",
        "desc": "A single main.py that runs and opens in Flow.",
        "files": {"main.py": 'def main():\n    print("Hello from @NAME@")\n\n\nmain()\n'},
    },
    {
        "id": "flask", "label": "Flask", "group": "Python",
        "desc": "A small Flask app with one route. Run it from the terminal.",
        "files": {
            "app.py": 'from flask import Flask\n\napp = Flask(__name__)\n\n\n@app.route("/")\ndef index():\n    return "Hello from @NAME@"\n\n\nif __name__ == "__main__":\n    app.run(debug=True)\n',
            "requirements.txt": "Flask>=3.0\n",
            "README.md": "# @NAME@\n\n```\npip install -r requirements.txt\npython app.py\n```\n",
        },
    },
    {
        "id": "fastapi", "label": "FastAPI", "group": "Python",
        "desc": "An ASGI app with a health route, served by uvicorn.",
        "files": {
            "main.py": 'from fastapi import FastAPI\n\napp = FastAPI(title="@NAME@")\n\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n',
            "requirements.txt": "fastapi>=0.110\nuvicorn>=0.29\n",
            "README.md": "# @NAME@\n\n```\npip install -r requirements.txt\nuvicorn main:app --reload\n```\n",
        },
    },
    {
        "id": "django", "label": "Django", "group": "Python",
        "desc": "A Django project with one app called core and a home view.",
        "files": {
            "requirements.txt": "Django>=5.0\n",
            "README.md": "# @NAME@\n\n```\npip install -r requirements.txt\npython manage.py runserver\n```\n",
            "manage.py": 'import os\nimport sys\n\n\ndef main():\n    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "@PKG@.settings")\n    from django.core.management import execute_from_command_line\n    execute_from_command_line(sys.argv)\n\n\nif __name__ == "__main__":\n    main()\n',
            "@PKG@/__init__.py": "",
            "@PKG@/settings.py": DJANGO_SETTINGS,
            "@PKG@/urls.py": 'from django.urls import include, path\n\nurlpatterns = [path("", include("core.urls"))]\n',
            "@PKG@/wsgi.py": 'import os\n\nfrom django.core.wsgi import get_wsgi_application\n\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "@PKG@.settings")\napplication = get_wsgi_application()\n',
            "@PKG@/asgi.py": 'import os\n\nfrom django.core.asgi import get_asgi_application\n\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "@PKG@.settings")\napplication = get_asgi_application()\n',
            "core/__init__.py": "",
            "core/views.py": 'from django.http import HttpResponse\n\n\ndef home(request):\n    return HttpResponse("Hello from @NAME@")\n',
            "core/urls.py": 'from django.urls import path\n\nfrom . import views\n\nurlpatterns = [path("", views.home, name="home")]\n',
        },
    },
    {
        "id": "spring", "label": "Spring Boot", "group": "Java",
        "desc": "A Maven Spring Boot app with one REST controller.",
        "files": {
            "pom.xml": '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>3.3.5</version>\n  </parent>\n  <groupId>com.example</groupId>\n  <artifactId>@PKG@</artifactId>\n  <version>0.0.1</version>\n  <properties>\n    <java.version>17</java.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-test</artifactId>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n',
            "src/main/java/com/example/Application.java": "package com.example;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class Application {\n    public static void main(String[] args) {\n        SpringApplication.run(Application.class, args);\n    }\n}\n",
            "src/main/java/com/example/HelloController.java": 'package com.example;\n\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class HelloController {\n    @GetMapping("/")\n    public String hello() {\n        return "Hello from @NAME@";\n    }\n}\n',
            "src/main/resources/application.properties": "server.port=8080\nspring.application.name=@PKG@\n",
            "README.md": "# @NAME@\n\n```\nmvn spring-boot:run\n```\n",
        },
    },
    {
        "id": "express", "label": "Node and Express", "group": "JavaScript",
        "desc": "An Express server with one route.",
        "files": {
            "package.json": '{\n  "name": "@PKG@",\n  "version": "0.1.0",\n  "main": "index.js",\n  "scripts": { "start": "node index.js" },\n  "dependencies": { "express": "^4.19.2" }\n}\n',
            "index.js": "const express = require('express');\n\nconst app = express();\n\napp.get('/', (req, res) => {\n  res.send('Hello from @NAME@');\n});\n\napp.listen(3000, () => console.log('http://localhost:3000'));\n",
            "README.md": "# @NAME@\n\n```\nnpm install\nnpm start\n```\n",
        },
    },
    {
        "id": "web", "label": "Static website", "group": "JavaScript",
        "desc": "An HTML page with a stylesheet and a script.",
        "files": {
            "index.html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>@NAME@</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>@NAME@</h1>\n  <script src="script.js"></script>\n</body>\n</html>\n',
            "style.css": "body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n",
            "script.js": "console.log('@NAME@ loaded');\n",
        },
    },
    {
        "id": "c", "label": "C program", "group": "C and C++",
        "desc": "A main.c and a CMake file.",
        "files": {
            "main.c": '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from @NAME@\\n");\n    return 0;\n}\n',
            "CMakeLists.txt": "cmake_minimum_required(VERSION 3.16)\nproject(@PKG@ C)\nadd_executable(@PKG@ main.c)\n",
        },
    },
    {
        "id": "cpp", "label": "C++ program", "group": "C and C++",
        "desc": "A main.cpp and a CMake file.",
        "files": {
            "main.cpp": '#include <iostream>\n\nint main() {\n    std::cout << "Hello from @NAME@\\n";\n    return 0;\n}\n',
            "CMakeLists.txt": "cmake_minimum_required(VERSION 3.16)\nproject(@PKG@ CXX)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(@PKG@ main.cpp)\n",
        },
    },
    {
        "id": "rust", "label": "Rust (Cargo)", "group": "Other",
        "desc": "A Cargo package with src/main.rs.",
        "files": {
            "Cargo.toml": '[package]\nname = "@PKG@"\nversion = "0.1.0"\nedition = "2021"\n',
            "src/main.rs": 'fn main() {\n    println!("Hello from @NAME@");\n}\n',
        },
    },
    {
        "id": "go", "label": "Go program", "group": "Other",
        "desc": "A single main.go.",
        "files": {"main.go": 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from @NAME@")\n}\n'},
    },
]


def listing():
    return [{"id": t["id"], "label": t["label"], "group": t["group"], "desc": t["desc"],
             "files": [p.replace("@PKG@", "pkg") for p in t["files"]]} for t in TEMPLATES]


def expand(template_id, name):
    """The (path, text) pairs a template creates for a project called `name`."""
    template = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if not template:
        return None
    pkg = package_name(name)
    return [(path.replace("@PKG@", pkg), text.replace("@PKG@", pkg).replace("@NAME@", name))
            for path, text in template["files"].items()]
