#ifndef ROOT7_REveTableInfo
#define ROOT7_REveTableInfo

#include <ROOT/REveElement.hxx>
#include <ROOT/REveDataClasses.hxx>

namespace ROOT {
namespace Experimental {

class REveTableEntry {
public:
   std::string    fName;
   std::string    fExpression;
   int            fPrecision;
   REveDataColumn::FieldType_e fType;

   REveTableEntry() : fName("unknown"), fPrecision(2), fType(REveDataColumn::FT_Double) {}
   void Print() const {
      printf("TableEntry\n");
      printf("name: %s expression: %s\n", fName.c_str(), fExpression.c_str());
   }
};

class REveTableHandle
{
   friend class REveTableViewInfo;

public:
   typedef std::vector<REveTableEntry> Entries_t;
   typedef std::map<std::string, Entries_t> Specs_t;

   // REveTableHandle() {}

   REveTableHandle&
   column(const char *name, int precision, const char *expression)
   {
      REveTableEntry columnEntry;
      columnEntry.fName = name;
      columnEntry.fPrecision = precision;
      columnEntry.fExpression = expression;

      fSpecs[fCollectionName].push_back(columnEntry);
      return *this;
   }

   REveTableHandle &column(const char *label, int precision)
   {
      return column(label, precision, label);
   }

   REveTableHandle(std::string collectionName, Specs_t &specs)
      :fCollectionName(collectionName), fSpecs(specs)
   {
      fSpecs[collectionName].clear();
   }

protected:
   std::string  fCollectionName;
   Specs_t&  fSpecs;
};


class REveTableViewInfo : REveElement
{
public:
   REveTableViewInfo(const std::string& name="", const std::string& title=""){ fName=name; fTitle=title; }

   typedef std::function<void (REveTableViewInfo*)> Delegate_t;
   std::function<void (REveTableViewInfo*)> _handler_func;

   void SetDisplayedCollection(std::string collectionName);
   std::string GetDisplayedCollection() const  { return fDisplayedCollection; }

   void AddDelegate(Delegate_t d) { fDelegates.push_back(d); }

   // read
   REveTableHandle::Entries_t& RefTableEntries(std::string cname) { return fSpecs[cname]; }

   // filling
   REveTableHandle table(std::string collectionName) {
      REveTableHandle handle(collectionName, fSpecs);
      return handle;
   }

private:
   std::string fDisplayedCollection;
   std::vector<Delegate_t> fDelegates;
   REveTableHandle::Specs_t  fSpecs;
};


}
}

#endif
