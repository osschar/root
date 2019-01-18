// @(#)root/eve:$Id$
// Author: Matevz Tadel 2007

/*************************************************************************
 * Copyright (C) 1995-2007, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#include <ROOT/REveSelection.hxx>
#include <ROOT/REveProjectionBases.hxx>
#include <ROOT/REveCompound.hxx>
#include <ROOT/REveManager.hxx>

#include "TClass.h"

using namespace ROOT::Experimental;
namespace REX = ROOT::Experimental;

/** \class REveSelection
\ingroup REve
Make sure there is a SINGLE running REveSelection for each
selection type (select/highlight).
*/

////////////////////////////////////////////////////////////////////////////////
/// Constructor.

REveSelection::REveSelection(const std::string& n, const std::string& t) :
   REveElement(n, t),
   fPickToSelect  (kPS_Projectable),
   fActive        (kTRUE),
   fIsMaster      (kTRUE)
{
   // XXXX Managing complete selection state on element level.
   //
   // Method pointers for propagation of selected / implied selected state
   // to elements. This has to be done differently now -- and kept within
   // REveSelection.
   //
   // From REveElement.h:
   // typedef void (REveElement::* Select_foo)      (Bool_t);
   // typedef void (REveElement::* ImplySelect_foo) ();
   //
   // From REveSelection.hxx:
   //    Select_foo       fSelElement;
   //    ImplySelect_foo  fIncImpSelElement;
   //    ImplySelect_foo  fDecImpSelElement;
   //
   // From this function:
   // fSelElement       = &REveElement::SelectElement;
   // fIncImpSelElement = &REveElement::IncImpliedSelected;
   // fDecImpSelElement = &REveElement::DecImpliedSelected;
   //
   // From SetHighlightMode:
   // fSelElement       = &REveElement::HighlightElement;
   // fIncImpSelElement = &REveElement::IncImpliedHighlighted;
   // fDecImpSelElement = &REveElement::DecImpliedHighlighted;
   //
   // Note that those REveElementFunctions have been removed.
   //
   // See calls commented with SSSS further down.
   //
   // Also, see REveManager::PreDeleteElement. We might need some sort of
   // implied-selected-count after all (global, for all selections,
   // highlights) ... and traverse all selections if the element gets zapped.
}

////////////////////////////////////////////////////////////////////////////////
/// Set to 'highlight' mode.

void REveSelection::SetHighlightMode()
{
   // Most importantly, this sets the pointers-to-function-members in
   // REveElement that are used to mark elements as (un)selected and
   // implied-(un)selected.

   fPickToSelect = kPS_Projectable;
   fIsMaster     = kFALSE;
}

////////////////////////////////////////////////////////////////////////////////
/// Select element indicated by the entry and fill its
/// implied-selected set.

void REveSelection::DoElementSelect(REveSelection::SelMap_i entry)
{
   REveElement *el  = entry->first;
   Set_t       &set = entry->second;

   // SSSS (el->*fSelElement)(kTRUE);
   el->FillImpliedSelectedSet(set);
   // SSSS for (Set_i i = set.begin(); i != set.end(); ++i)
   // SSSS    ((*i)->*fIncImpSelElement)();
}

////////////////////////////////////////////////////////////////////////////////
/// Deselect element indicated by the entry and clear its
/// implied-selected set.

void REveSelection::DoElementUnselect(REveSelection::SelMap_i entry)
{
   // SSSS REveElement *el  = entry->first;
   Set_t       &set = entry->second;

   // SSSS for (Set_i i = set.begin(); i != set.end(); ++i)
   // SSSS    ((*i)->*fDecImpSelElement)();
   set.clear();
   // SSSS (el->*fSelElement)(kFALSE);
}

////////////////////////////////////////////////////////////////////////////////
/// Pre-addition check. Deny addition if el is already selected.
/// Virtual from REveElement.

Bool_t REveSelection::AcceptElement(REveElement* el)
{
   return el != this && fImpliedSelected.find(el) == fImpliedSelected.end() &&
          el->IsA()->InheritsFrom(REveSelection::Class()) == kFALSE;
}

////////////////////////////////////////////////////////////////////////////////
/// Add an element into selection, virtual from REveElement.

void REveSelection::AddElement(REveElement* el)
{
   REveElement::AddElement(el);
   el->IncParentIgnoreCnt();

   SelMap_i i = fImpliedSelected.insert(std::make_pair(el, Set_t())).first;
   if (fActive)
   {
      DoElementSelect(i);
   }
   SelectionAdded(el);
}

////////////////////////////////////////////////////////////////////////////////
/// Add an element into selection, virtual from REveElement.
/// Overriden here just so that a signal can be emitted.

void REveSelection::RemoveElement(REveElement* el)
{
   el->DecParentIgnoreCnt();
   REveElement::RemoveElement(el);
   SelectionRemoved(el);
}

////////////////////////////////////////////////////////////////////////////////
/// Virtual from REveElement.

void REveSelection::RemoveElementLocal(REveElement* el)
{
   SelMap_i i = fImpliedSelected.find(el);

   if (i != fImpliedSelected.end())
   {
      if (fActive)
      {
         DoElementUnselect(i);
      }
      fImpliedSelected.erase(i);
   }
   else
   {
      Warning("REveSelection::RemoveElementLocal", "element not found in map.");
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Add an element into selection, virtual from REveElement.
/// Overriden here just so that a signal can be emitted.

void REveSelection::RemoveElements()
{
   for (auto & el : fChildren)
   {
      el->DecParentIgnoreCnt();
   }
   REveElement::RemoveElements();
   SelectionCleared();
}

////////////////////////////////////////////////////////////////////////////////
/// Virtual from REveElement.

void REveSelection::RemoveElementsLocal()
{
   if (fActive)
   {
      for (SelMap_i i = fImpliedSelected.begin(); i != fImpliedSelected.end(); ++i)
         DoElementUnselect(i);
   }
   fImpliedSelected.clear();
}

////////////////////////////////////////////////////////////////////////////////
/// Remove element from all implied-selected sets.
///
/// This is called as part of the element destruction from
/// REveManager::PreDeleteElement() and should not be called
/// directly.

void REveSelection::RemoveImpliedSelected(REveElement* el)
{
   for (SelMap_i i = fImpliedSelected.begin(); i != fImpliedSelected.end(); ++i)
   {
      Set_i j = i->second.find(el);
      if (j != i->second.end())
         i->second.erase(j);
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Recalculate implied-selected state for given selection entry.
/// Add new elements to implied-selected set and increase their
/// implied-selected count.

void REveSelection::RecheckImpliedSet(SelMap_i smi)
{
   Set_t set;
   smi->first->FillImpliedSelectedSet(set);
   for (Set_i i = set.begin(); i != set.end(); ++i)
   {
      if (smi->second.find(*i) == smi->second.end())
      {
         smi->second.insert(*i);
         // SSSS ((*i)->*fIncImpSelElement)();
      }
   }
}

////////////////////////////////////////////////////////////////////////////////
/// If given element is selected or implied-selected with this
/// selection and recheck implied-set for given selection entry.

void REveSelection::RecheckImpliedSetForElement(REveElement* el)
{
   // Top-level selected.
   {
      SelMap_i i = fImpliedSelected.find(el);
      if (i != fImpliedSelected.end())
         RecheckImpliedSet(i);
   }

   // Implied selected, need to loop over all.
   {
      for (SelMap_i i = fImpliedSelected.begin(); i != fImpliedSelected.end(); ++ i)
      {
         if (i->second.find(el) != i->second.end())
            RecheckImpliedSet(i);
      }
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Emit SelectionAdded signal.

void REveSelection::SelectionAdded(REveElement* /*el*/)
{
   // XXXX
   // Emit("SelectionAdded(REveElement*)", (Long_t)el);
}

////////////////////////////////////////////////////////////////////////////////
/// Emit SelectionRemoved signal.

void REveSelection::SelectionRemoved(REveElement* /*el*/)
{
   // XXXX
   // Emit("SelectionRemoved(REveElement*)", (Long_t)el);
}

////////////////////////////////////////////////////////////////////////////////
/// Emit SelectionCleared signal.

void REveSelection::SelectionCleared()
{
   // XXXX
   // Emit("SelectionCleared()");
}

////////////////////////////////////////////////////////////////////////////////
/// Emit SelectionRepeated signal.

void REveSelection::SelectionRepeated(REveElement* /*el*/)
{
   // XXXX
   // Emit("SelectionRepeated(REveElement*)", (Long_t)el);
}

////////////////////////////////////////////////////////////////////////////////
/// Activate this selection.

void REveSelection::ActivateSelection()
{
   for (SelMap_i i = fImpliedSelected.begin(); i != fImpliedSelected.end(); ++i)
      DoElementSelect(i);
   fActive = kTRUE;
}

////////////////////////////////////////////////////////////////////////////////
/// Deactivate this selection.

void REveSelection::DeactivateSelection()
{
   fActive = kFALSE;
   for (SelMap_i i = fImpliedSelected.begin(); i != fImpliedSelected.end(); ++i)
      DoElementUnselect(i);
}

////////////////////////////////////////////////////////////////////////////////
/// Given element el that was picked or clicked by the user, find
/// the parent/ancestor element that should actually become the main
/// selected element according to current selection mode.

REveElement* REveSelection::MapPickedToSelected(REveElement* el)
{
   if (el == nullptr)
      return nullptr;

   if (el->ForwardSelection())
   {
      return el->ForwardSelection();
   }

   switch (fPickToSelect)
   {
      case kPS_Ignore:
      {
         return nullptr;
      }
      case kPS_Element:
      {
         return el;
      }
      case kPS_Projectable:
      {
         REveProjected* pted = dynamic_cast<REveProjected*>(el);
         if (pted)
            return dynamic_cast<REveElement*>(pted->GetProjectable());
         return el;
      }
      case kPS_Compound:
      {
         REveElement* cmpnd = el->GetCompound();
         if (cmpnd)
            return cmpnd;
         return el;
      }
      case kPS_PableCompound:
      {
         REveProjected* pted = dynamic_cast<REveProjected*>(el);
         if (pted)
            el = dynamic_cast<REveElement*>(pted->GetProjectable());
         REveElement* cmpnd = el->GetCompound();
         if (cmpnd)
            return cmpnd;
         return el;
      }
      case kPS_Master:
      {
         REveElement* mstr = el->GetMaster();
         if (mstr)
            return mstr;
         return el;
      }
   }
   return el;
}

////////////////////////////////////////////////////////////////////////////////
/// Called when user picks/clicks on an element. If multi is true,
/// the user is requiring a multiple selection (usually this is
/// associated with control-key being pressed at the time of pick
/// event).

void REveSelection::UserPickedElement(REveElement* el, Bool_t multi)
{
   el = MapPickedToSelected(el);

   if (el || HasChildren())
   {
      if (!multi)
         RemoveElements();
      if (el)
      {
         if (HasChild(el))
             RemoveElement(el);
         else
            AddElement(el);
      }
      if (fIsMaster)
         REX::gEve->ElementSelect(el);
      REX::gEve->Redraw3D();
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Called when element selection is repeated.

void REveSelection::UserRePickedElement(REveElement* el)
{
   el = MapPickedToSelected(el);
   if (el && HasChild(el))
   {
      SelectionRepeated(el);
      REX::gEve->Redraw3D();
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Called when an element is unselected.

void REveSelection::UserUnPickedElement(REveElement* el)
{
   el = MapPickedToSelected(el);
   if (el)
   {
      RemoveElement(el);
      REX::gEve->Redraw3D();
   }
}
