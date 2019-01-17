#include <ROOT/REveDataCollectionManager.hxx>
#include <ROOT/REveDataClasses.hxx>
#include <ROOT/REveCompound.hxx>

using namespace ROOT::Experimental;
namespace REX = ROOT::Experimental;

REveDataCollectionManager::REveDataCollectionManager(const std::string& n, const std::string& t) :
   REveElement(n, t)
{
}

////////////////////////////////////////////////////////////////
/// constructors and destructor

REveDataInteractionList::REveDataInteractionList(const REveDataCollection* item)
   : m_collection(item)
{}


REveDataInteractionList::~REveDataInteractionList()
{
   for ( std::vector<REveCompound*>::iterator i = m_compounds.begin(); i != m_compounds.end(); ++i)
   {
      /*
      // Interaction are created only in the standard use case, where user data is FWFromEveSelectorBase.
      // This is defined with return value of virtual function FWPRoxyBuilderBase::willHandleInteraction().

      if ((*i)->GetUserData())
         delete reinterpret_cast<FWFromEveSelectorBase*>((*i)->GetUserData());
      */
      (*i)->RemoveElements();
      (*i)->DecDenyDestroy();
   }
}


//
// member functions
//

/** This function is called from FWProxyBuilderBase::build() function (e.g. on next event).
    The PB build function creates REveElement for each element of collection and calls
    this function to add the element to "master" element, which is a REveCompound.
*/
void
REveDataInteractionList::Added(REveElement* el, unsigned int idx)
{

   // In the case a compound for the given index already exists, just add
   // the REveElement to it, otherwise create a new one.
   if (idx < m_compounds.size())
   {
      m_compounds[idx]->AddElement(el);
      return;
   }

   // Prepare name for the tooltip on mouseover in GL viewer.Value of
   // tooltip is REveElement::fTitle

   /*
   if (m_collection->haveInterestingValue())
      name += m_collection->modelInterestingValueAsString(idx);
   */
   auto bi = m_collection->BeginChildren();
   std::advance(bi, idx);
   std::string name = (*bi)->GetName();

   REveCompound* c = new REveCompound(name.c_str(), name.c_str());
   c->EnableListElements(m_collection->GetRnrSelf());
   c->SetMainColor(m_collection->GetMainColor());
   c->SetMainTransparency(m_collection->GetMainTransparency());

   // Set flags to propagat attributes.
   c->CSCImplySelectAllChildren();
   c->CSCApplyMainColorToAllChildren();
   c->CSCApplyMainTransparencyToAllChildren();

   // REveElement is auto-destroyed if is is not added to any parent. Alternative could
   // be to use increase/decrease reference count.
   c->IncDenyDestroy();

   /*
   //  FWModelIdFromEveSelector is needed for interaction from Eve to Fireworks.
   //  FWEveViewManager gets ROOT signals with selected objects (REveCompound)
   //  then cals doSelect() on the compound's user data.
   c->SetUserData(new FWModelIdFromEveSelector(FWModelId(m_collection, idx)));
   */
   // Order does not matter. What is added to REveCompound is not concern of interaction list.
   // Interaction list operates ony with the compound.
   m_compounds.push_back(c);
   m_compounds.back()->AddElement(el);
   // printf("%s[%d] REveDataInteractionList::added has childern %d\n",m_collection->name().c_str(), idx,  m_compounds[idx]->NumChildren());
}
