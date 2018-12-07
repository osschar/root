#ifndef ROOT7_REveDataCollectionManager
#define ROOT7_REveDataCollectionManager

#include <ROOT/REveElement.hxx>
#include <ROOT/REveDataClasses.hxx>

namespace ROOT {
namespace Experimental {

class REveTrackPropagator;

class REveDataCollectionManager : public REveElementList {
public:
   REveDataCollectionManager(const char *n = "REveDataCollection", const char *t = "");
   virtual ~REveDataCollectionManager() {}

   // AMT
   // save and restore from configuration
   // collection default setting
   // emit collection addded / removed ...?

   ClassDef(REveDataCollectionManager, 0);
};


//______________________________________________________________________________
//______________________________________________________________________________
//______________________________________________________________________________

class REveViewContext  {
private:
   float m_R;
   float m_Z;
   REveTrackPropagator* m_trackPropagator;

public:
   REveViewContext(): m_R(100), m_Z(100), m_trackPropagator(0) {}
   virtual ~REveViewContext(){}

   void SetBarrel(float r, float z) { m_R = r; m_Z = z; }
   void SetTrackPropagator( REveTrackPropagator* p) {m_trackPropagator = p; }

   float GetMaxR() const {return m_R;}
   float GetMaxZ() const {return m_Z;}
   REveTrackPropagator* GetPropagator() const {return m_trackPropagator;}

   ClassDef(REveViewContext, 0);
};

//______________________________________________________________________________
//______________________________________________________________________________
//______________________________________________________________________________


class REveDataInteractionList
{
public:
   REveDataInteractionList(const REveDataCollection* collection);
   virtual ~REveDataInteractionList();

   const REveDataCollection* collection() const { return m_collection;}
   bool Empty() const { return m_compounds.empty(); }

   void Added(REveElement*, unsigned int);
   //   void removed(REveElement*, int);

   void ModelChanges(const std::set<REveDataCollection::Ids_t>&);
   void ItemChanged();

private:
   std::vector<REveCompound*> m_compounds;
   const REveDataCollection*  m_collection;

   ClassDef(REveDataInteractionList, 0);
};




} // namespace Experimental
} // namespace ROOT
#endif
