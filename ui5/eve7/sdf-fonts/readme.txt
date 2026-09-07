SDF fonts for REve
==================

This directory holds the signed-distance-field atlases REve uses to render text.
Each font is a pair of files:

    <name>.png     the distance field itself
    <name>.js.gz   the glyph metrics (advances, kerning, rectangles)

Both are *generated artefacts* and are not kept in git -- only this file is. A
fresh checkout therefore starts with no atlases, and the first thing that wants
text has to build them.

Generating
----------

REveText::AssertSdfFont(font_name, ttf_path) is the entry point. It is a no-op
when both files for font_name are already present, and otherwise builds them
from the TTF -- via TGLSdfFontMaker in the RGL module, called through the
interpreter so that REve does not have to link against RGL.

Three conditions have to hold, and none of them announces itself clearly:

 1. REveManager must already exist. AssertSdfFont() needs the font directory,
    which is set up as part of manager construction. Called earlier,
    SetDefaultSdfFontDir() fails and AssertSdfFont() then returns without
    generating anything and without an obvious error -- it looks like it worked.

 2. A real GL context, so generation cannot happen in batch mode. `root.exe -b`
    fails with "TGLWidget::CreateWindow: Display is not set!". Run once with a
    display to populate the directory; after that batch sessions are fine,
    because AssertSdfFont() sees the files and does nothing.

 3. A writable target directory. Two defaults are tried in order --
    $ROOTSYS/ui5/eve7/sdf-fonts/ and ./sdf-fonts/ -- and the first writable one
    wins. REveText::SetSdfFontDir(dir, require_write_access) overrides that; pass
    false for require_write_access when pointing at a directory that is already
    populated.

Note that a development setup serving ui5 from the source tree
(WebGui.RootUi5Path) reads atlases from the *source* ui5/eve7/sdf-fonts, while
AssertSdfFont() writes to $ROOTSYS/..., i.e. into the *build* tree. If text
renders as nothing after a successful-looking generation, check which of the two
directories the files landed in.

Which fonts to ask for
----------------------

Only faces that ship in $ROOTSYS/fonts can be relied on. That includes
LiberationMono-Regular and LiberationSerif-Regular, arial and arialbd, verdana,
georgia, comic, comicbd and BlackChancery -- but *not* Liberation Sans, in any
weight. Naming a system path such as /usr/share/fonts/liberation-sans ties the
code to one distribution's layout.

LiberationSerif-Regular is REveText's default and is what REveViewer and
GlViewerRCore use for the viewer axes.

For bold, prefer REveText::SetFontWeight() over a second atlas: weight is applied
by moving the SDF threshold, so it is continuous and needs no extra font. Several
of the faces above have no bold variant in ROOT at all.

See also: REveText, and tutorials/visualisation/eve7/texts.C and texts_grid.C.
