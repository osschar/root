// @(#)root/core/metacling:$Id$
// Author: Matevz Tadel   13/10/2026

/*************************************************************************
 * Copyright (C) 1995-2026, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#include "TClingDisposable.h"

#include "TVirtualMutex.h"

#include "cling/Interpreter/Interpreter.h"

#include "clang/Frontend/CompilerInstance.h"
#include "clang/Lex/PreprocessorOptions.h"

#include <algorithm>
#include <cstring>

////////////////////////////////////////////////////////////////////////////////
/// Create the interpreter with `args`, the arguments of gInterpreter, and cling's
/// `--disposable`. It runs without cling's runtime: it does not print values.
///
/// ROOT's LLVM is built without thread support, so only one interpreter may
/// compile at a time. Creation, every call and destruction take gInterpreterMutex.

TClingDisposable::TClingDisposable(const std::vector<std::string> &args, const std::string &llvmResourceDir)
   : fArgs(args)
{
   fArgs.push_back("--disposable");
   for (const auto &arg : fArgs)
      fArgv.push_back(arg.c_str());

   R__LOCKGUARD(gInterpreterMutex);
   fInterpreter = std::make_unique<cling::Interpreter>(fArgv.size(), fArgv.data(), llvmResourceDir.c_str(),
                                                       cling::Interpreter::ModuleFileExtensions{},
                                                       /*extraLibHandle=*/nullptr, /*noRuntime=*/true);
   if (!fInterpreter->getCI()) {
      fInterpreter.reset();
      return;
   }

   // The same settings as TCling's: do not check whether the modules' files exist,
   // no spell checking, and modules on or off as in the arguments.
   clang::CompilerInstance &CI = *fInterpreter->getCI();
   CI.getPreprocessorOpts().DisablePCHOrModuleValidation = clang::DisableValidationForModuleKind::All;
   CI.getLangOpts().SpellChecking = false;
   CI.getLangOpts().Modules =
      std::any_of(fArgv.begin(), fArgv.end(), [](const char *arg) { return !strcmp(arg, "-fmodules"); });
}

////////////////////////////////////////////////////////////////////////////////
/// Destroy the interpreter, and with it all the code it compiled.

TClingDisposable::~TClingDisposable()
{
   R__LOCKGUARD(gInterpreterMutex);
   fInterpreter.reset();
}

////////////////////////////////////////////////////////////////////////////////
/// Declare code, eg #include directives. Return false on error.

bool TClingDisposable::Declare(const char *code)
{
   R__LOCKGUARD(gInterpreterMutex);
   return fInterpreter->declare(code) == cling::Interpreter::kSuccess;
}

////////////////////////////////////////////////////////////////////////////////
/// Compile and run a line. Return false on error.

bool TClingDisposable::ProcessLine(const char *line)
{
   R__LOCKGUARD(gInterpreterMutex);
   return fInterpreter->process(line, /*V=*/nullptr, /*T=*/nullptr, /*disableValuePrinting=*/true) ==
          cling::Interpreter::kSuccess;
}
