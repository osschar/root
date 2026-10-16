// @(#)root/core/metacling:$Id$
// Author: Matevz Tadel   13/10/2026

/*************************************************************************
 * Copyright (C) 1995-2026, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT_TClingDisposable
#define ROOT_TClingDisposable

#include "TInterpreter.h"

#include <memory>
#include <string>
#include <vector>

namespace cling {
class Interpreter;
}

/// A cling interpreter created with cling's `--disposable` option, which frees
/// all its memory, compiled code included, when it is destroyed. See
/// TInterpreter::Disposable.
class TClingDisposable final : public TInterpreter::Disposable {
   std::vector<std::string> fArgs;                   ///< cling keeps pointers into the arguments
   std::vector<const char *> fArgv;                  ///< The arguments as passed to cling
   std::unique_ptr<cling::Interpreter> fInterpreter; ///< Declared last, so destroyed first

public:
   TClingDisposable(const std::vector<std::string> &args, const std::string &llvmResourceDir);
   ~TClingDisposable() override;

   bool IsValid() const { return fInterpreter != nullptr; }

   bool Declare(const char *code) final;
   bool ProcessLine(const char *line) final;
};

#endif
